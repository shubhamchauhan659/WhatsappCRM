-- ============================================================
-- 060_receivables.sql — PaisaFollow receivables module
--
-- Adds invoices, payments (incl. credit notes), payment follow-ups
-- (with promise-to-pay) and an append-only audit trail, plus the
-- business-profile columns the reminders need.
--
-- Invariants enforced HERE, not in the UI, so every write path
-- (browser client, API route, service role, CSV import) gets them:
--
--   * Money is integer paise (BIGINT). No floating point.
--   * invoices.paid_paise / credited_paise are maintained only by the
--     invoice_payments trigger; clients cannot write them. Insert
--     always starts at 0, so an invoice can never be "paid" without
--     payment rows behind it.
--   * outstanding_paise is a generated column; CHECK constraints make
--     over-payment and payments against cancelled invoices impossible.
--   * Payments are immutable: the only permitted update is the one-way
--     void transition. Corrections = void + re-enter (full audit trail).
--   * Tenant integrity: RLS via is_account_member() AND composite
--     foreign keys on (account_id, id), so a row can never reference a
--     customer or invoice belonging to another business — not even by
--     guessing a UUID.
--   * Retries are idempotent: payments and follow-ups accept a
--     client-generated client_ref with a per-account unique index.
--
-- Idempotent like the rest of the chain (IF NOT EXISTS / DROP-then-
-- CREATE / guarded DO blocks), safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Business profile on accounts
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_valid_timezone(tz TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF tz IS NULL OR tz = '' THEN
    RETURN FALSE;
  END IF;
  PERFORM NOW() AT TIME ZONE tz;
  RETURN TRUE;
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END;
$$;

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS business_address TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS business_phone TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS business_email TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS business_gstin TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS business_upi_id TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS business_logo_url TEXT;

-- India-first: new businesses default to INR. Existing rows keep theirs.
ALTER TABLE accounts ALTER COLUMN default_currency SET DEFAULT 'INR';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounts_timezone_valid') THEN
    ALTER TABLE accounts ADD CONSTRAINT accounts_timezone_valid
      CHECK (public.is_valid_timezone(timezone));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounts_business_profile_lengths') THEN
    ALTER TABLE accounts ADD CONSTRAINT accounts_business_profile_lengths CHECK (
      (business_address IS NULL OR char_length(business_address) <= 500)
      AND (business_phone IS NULL OR char_length(business_phone) <= 32)
      AND (business_email IS NULL OR char_length(business_email) <= 254)
      AND (business_logo_url IS NULL OR (char_length(business_logo_url) <= 2048 AND business_logo_url ~ '^https://'))
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounts_business_gstin_format') THEN
    ALTER TABLE accounts ADD CONSTRAINT accounts_business_gstin_format
      CHECK (business_gstin IS NULL OR business_gstin ~ '^[0-9]{2}[0-9A-Z]{13}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounts_business_upi_format') THEN
    ALTER TABLE accounts ADD CONSTRAINT accounts_business_upi_format
      CHECK (business_upi_id IS NULL OR business_upi_id ~ '^[A-Za-z0-9._-]{2,256}@[A-Za-z][A-Za-z0-9.-]{1,63}$');
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2. Composite key on contacts so children can FK (account_id, id)
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_account_id_id_key') THEN
    ALTER TABLE contacts ADD CONSTRAINT contacts_account_id_id_key UNIQUE (account_id, id);
  END IF;
END $$;

-- ------------------------------------------------------------
-- 3. invoices
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL,
  invoice_number TEXT NOT NULL,
  issue_date DATE NOT NULL,
  due_date DATE NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  total_paise BIGINT NOT NULL,
  paid_paise BIGINT NOT NULL DEFAULT 0,
  credited_paise BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',
  outstanding_paise BIGINT GENERATED ALWAYS AS (
    CASE WHEN status = 'cancelled' THEN 0 ELSE total_paise - paid_paise - credited_paise END
  ) STORED,
  notes TEXT,
  cancelled_at TIMESTAMPTZ,
  cancel_reason TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT invoices_account_id_id_key UNIQUE (account_id, id),
  CONSTRAINT invoices_contact_fk FOREIGN KEY (account_id, contact_id)
    REFERENCES contacts (account_id, id),
  CONSTRAINT invoices_number_format CHECK (
    invoice_number = btrim(invoice_number) AND char_length(invoice_number) BETWEEN 1 AND 64
  ),
  CONSTRAINT invoices_dates_order CHECK (due_date >= issue_date),
  CONSTRAINT invoices_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  -- Upper bound: 10^14 paise = ₹1 lakh crore. Keeps sums far from BIGINT overflow.
  CONSTRAINT invoices_total_range CHECK (total_paise > 0 AND total_paise <= 100000000000000),
  CONSTRAINT invoices_settled_nonnegative CHECK (paid_paise >= 0 AND credited_paise >= 0),
  CONSTRAINT invoices_not_overpaid CHECK (paid_paise + credited_paise <= total_paise),
  CONSTRAINT invoices_status_valid CHECK (status IN ('open', 'cancelled')),
  CONSTRAINT invoices_cancel_requires_no_settlement CHECK (
    status <> 'cancelled' OR (paid_paise = 0 AND credited_paise = 0)
  ),
  CONSTRAINT invoices_source_valid CHECK (source IN ('manual', 'import', 'api')),
  CONSTRAINT invoices_text_lengths CHECK (
    (notes IS NULL OR char_length(notes) <= 2000)
    AND (cancel_reason IS NULL OR char_length(cancel_reason) <= 500)
  )
);

-- Invoice numbers are unique per business, case-insensitively, so a
-- re-run CSV import cannot create "INV-1" and "inv-1".
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_account_number
  ON invoices (account_id, upper(invoice_number));
CREATE INDEX IF NOT EXISTS idx_invoices_account_contact
  ON invoices (account_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_invoices_account_open_due
  ON invoices (account_id, due_date)
  WHERE status = 'open' AND outstanding_paise > 0;
CREATE INDEX IF NOT EXISTS idx_invoices_account_created
  ON invoices (account_id, created_at DESC);

-- ------------------------------------------------------------
-- 4. invoice_payments (payments + credit notes)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoice_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL,
  kind TEXT NOT NULL DEFAULT 'payment',
  amount_paise BIGINT NOT NULL,
  paid_on DATE NOT NULL,
  method TEXT NOT NULL DEFAULT 'other',
  reference TEXT,
  notes TEXT,
  client_ref UUID,
  voided_at TIMESTAMPTZ,
  void_reason TEXT,
  voided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  recorded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT invoice_payments_invoice_fk FOREIGN KEY (account_id, invoice_id)
    REFERENCES invoices (account_id, id),
  CONSTRAINT invoice_payments_kind_valid CHECK (kind IN ('payment', 'credit_note')),
  CONSTRAINT invoice_payments_amount_range CHECK (amount_paise > 0 AND amount_paise <= 100000000000000),
  CONSTRAINT invoice_payments_method_valid CHECK (
    method IN ('cash', 'upi', 'bank_transfer', 'cheque', 'card', 'other')
  ),
  CONSTRAINT invoice_payments_void_consistent CHECK ((voided_at IS NULL) = (void_reason IS NULL)),
  CONSTRAINT invoice_payments_text_lengths CHECK (
    (reference IS NULL OR char_length(reference) <= 120)
    AND (notes IS NULL OR char_length(notes) <= 1000)
    AND (void_reason IS NULL OR char_length(void_reason) BETWEEN 1 AND 500)
  )
);

CREATE INDEX IF NOT EXISTS idx_invoice_payments_account_invoice
  ON invoice_payments (account_id, invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_account_paid_on
  ON invoice_payments (account_id, paid_on DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_payments_client_ref
  ON invoice_payments (account_id, client_ref)
  WHERE client_ref IS NOT NULL;

-- ------------------------------------------------------------
-- 5. follow_ups (history + promise-to-pay)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS follow_ups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL,
  invoice_id UUID,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  status TEXT NOT NULL,
  summary TEXT,
  message TEXT,
  -- Lets list views skip the (large) message body and fetch it on demand.
  has_message BOOLEAN GENERATED ALWAYS AS (message IS NOT NULL) STORED,
  next_follow_up_on DATE,
  promise_date DATE,
  promised_paise BIGINT,
  dispute_reason TEXT,
  internal_notes TEXT,
  client_ref UUID,
  recorded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT follow_ups_contact_fk FOREIGN KEY (account_id, contact_id)
    REFERENCES contacts (account_id, id) ON DELETE CASCADE,
  -- MATCH SIMPLE (default): a NULL invoice_id means "customer-level".
  CONSTRAINT follow_ups_invoice_fk FOREIGN KEY (account_id, invoice_id)
    REFERENCES invoices (account_id, id) ON DELETE CASCADE,
  CONSTRAINT follow_ups_channel_valid CHECK (
    channel IN ('whatsapp', 'call', 'sms', 'email', 'in_person', 'other')
  ),
  CONSTRAINT follow_ups_status_valid CHECK (status IN (
    'not_contacted', 'reminder_drafted', 'reminder_sent', 'customer_replied',
    'promise_to_pay', 'disputed', 'partially_paid', 'paid', 'follow_up_required'
  )),
  CONSTRAINT follow_ups_promise_complete CHECK (
    status <> 'promise_to_pay' OR (promise_date IS NOT NULL AND promised_paise IS NOT NULL)
  ),
  CONSTRAINT follow_ups_promised_range CHECK (
    promised_paise IS NULL OR (promised_paise > 0 AND promised_paise <= 100000000000000)
  ),
  CONSTRAINT follow_ups_dispute_has_reason CHECK (
    status <> 'disputed' OR char_length(btrim(COALESCE(dispute_reason, ''))) > 0
  ),
  CONSTRAINT follow_ups_text_lengths CHECK (
    (summary IS NULL OR char_length(summary) <= 2000)
    AND (message IS NULL OR char_length(message) <= 4000)
    AND (dispute_reason IS NULL OR char_length(dispute_reason) <= 1000)
    AND (internal_notes IS NULL OR char_length(internal_notes) <= 2000)
  )
);

CREATE INDEX IF NOT EXISTS idx_follow_ups_account_contact_time
  ON follow_ups (account_id, contact_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_follow_ups_account_invoice
  ON follow_ups (account_id, invoice_id)
  WHERE invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_follow_ups_account_promise
  ON follow_ups (account_id, promise_date)
  WHERE status = 'promise_to_pay';
CREATE INDEX IF NOT EXISTS idx_follow_ups_account_next
  ON follow_ups (account_id, next_follow_up_on)
  WHERE next_follow_up_on IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_follow_ups_account_time
  ON follow_ups (account_id, occurred_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_follow_ups_client_ref
  ON follow_ups (account_id, client_ref)
  WHERE client_ref IS NOT NULL;

-- ------------------------------------------------------------
-- 6. audit_events (append-only; written only by triggers)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- No FK: the trail must survive the actor's user being deleted.
  actor_user_id UUID,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  action TEXT NOT NULL,
  changes JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT audit_events_action_valid CHECK (action IN ('insert', 'update', 'delete', 'void'))
);

CREATE INDEX IF NOT EXISTS idx_audit_events_account_time
  ON audit_events (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_entity
  ON audit_events (account_id, entity_type, entity_id);

-- ------------------------------------------------------------
-- 7. Trigger functions
-- ------------------------------------------------------------

-- 7a. invoices BEFORE INSERT/UPDATE: totals are trigger-owned.
CREATE OR REPLACE FUNCTION public.guard_invoice_write()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Settlement always starts at zero; only payment rows move it.
    NEW.paid_paise := 0;
    NEW.credited_paise := 0;
    IF auth.uid() IS NOT NULL THEN
      NEW.created_by := auth.uid();
    END IF;
    IF NEW.status = 'cancelled' AND NEW.cancelled_at IS NULL THEN
      NEW.cancelled_at := NOW();
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE from an end-user session (PostgREST roles). The payment
  -- trigger runs as the function owner, so it is not caught here.
  IF current_user IN ('authenticated', 'anon') THEN
    IF NEW.paid_paise IS DISTINCT FROM OLD.paid_paise
       OR NEW.credited_paise IS DISTINCT FROM OLD.credited_paise THEN
      RAISE EXCEPTION 'paid/credited totals are derived from payments and cannot be edited'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.account_id IS DISTINCT FROM OLD.account_id
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.source IS DISTINCT FROM OLD.source THEN
      RAISE EXCEPTION 'invoice identity columns cannot be changed'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' THEN
    NEW.cancelled_at := NOW();
  ELSIF NEW.status = 'open' AND OLD.status = 'cancelled' THEN
    NEW.cancelled_at := NULL;
    NEW.cancel_reason := NULL;
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

-- 7b. invoice_payments BEFORE INSERT/UPDATE: immutability + actor stamping.
CREATE OR REPLACE FUNCTION public.guard_invoice_payment_write()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.voided_at IS NOT NULL OR NEW.void_reason IS NOT NULL THEN
      RAISE EXCEPTION 'a payment cannot be inserted already voided'
        USING ERRCODE = '22023';
    END IF;
    IF auth.uid() IS NOT NULL THEN
      NEW.recorded_by := auth.uid();
    END IF;
    NEW.voided_by := NULL;
    RETURN NEW;
  END IF;

  -- UPDATE: only the one-way void transition is allowed.
  IF (to_jsonb(NEW) - 'voided_at' - 'void_reason' - 'voided_by')
     IS DISTINCT FROM (to_jsonb(OLD) - 'voided_at' - 'void_reason' - 'voided_by') THEN
    RAISE EXCEPTION 'payments are immutable; void this payment and record a new one'
      USING ERRCODE = '42501';
  END IF;
  IF OLD.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'payment is already void' USING ERRCODE = '22023';
  END IF;
  IF NEW.voided_at IS NULL THEN
    RETURN NEW;  -- no-op update
  END IF;
  NEW.voided_at := NOW();  -- no back-dating
  NEW.voided_by := COALESCE(auth.uid(), NEW.voided_by);
  RETURN NEW;
END;
$$;

-- 7c. invoice_payments AFTER INSERT/UPDATE/DELETE: maintain totals.
-- Increment/decrement (not re-SUM) so concurrent payments serialise on
-- the invoice row lock and re-read the latest committed totals; the
-- invoices CHECK constraints then reject any over-payment atomically.
CREATE OR REPLACE FUNCTION public.apply_invoice_payment_totals()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice_id UUID;
  v_kind TEXT;
  v_delta BIGINT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_invoice_id := NEW.invoice_id;
    v_kind := NEW.kind;
    v_delta := NEW.amount_paise;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NOT (OLD.voided_at IS NULL AND NEW.voided_at IS NOT NULL) THEN
      RETURN NEW;
    END IF;
    v_invoice_id := OLD.invoice_id;
    v_kind := OLD.kind;
    v_delta := -OLD.amount_paise;
  ELSE
    IF OLD.voided_at IS NOT NULL THEN
      RETURN OLD;
    END IF;
    v_invoice_id := OLD.invoice_id;
    v_kind := OLD.kind;
    v_delta := -OLD.amount_paise;
  END IF;

  IF v_kind = 'payment' THEN
    UPDATE invoices SET paid_paise = paid_paise + v_delta WHERE id = v_invoice_id;
  ELSE
    UPDATE invoices SET credited_paise = credited_paise + v_delta WHERE id = v_invoice_id;
  END IF;
  -- During an account-wide cascade the invoice may already be gone; a
  -- zero-row update is correct then.

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- 7d. follow_ups BEFORE INSERT/UPDATE: actor stamping + updated_at.
CREATE OR REPLACE FUNCTION public.guard_follow_up_write()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NOT NULL THEN
      NEW.recorded_by := auth.uid();
    END IF;
  ELSE
    IF current_user IN ('authenticated', 'anon') AND (
      NEW.id IS DISTINCT FROM OLD.id
      OR NEW.account_id IS DISTINCT FROM OLD.account_id
      OR NEW.recorded_by IS DISTINCT FROM OLD.recorded_by
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
      OR NEW.client_ref IS DISTINCT FROM OLD.client_ref
      OR NEW.message IS DISTINCT FROM OLD.message
    ) THEN
      RAISE EXCEPTION 'follow-up identity columns cannot be changed'
        USING ERRCODE = '42501';
    END IF;
    NEW.updated_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

-- 7e. Generic audit trigger.
CREATE OR REPLACE FUNCTION public.record_audit_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new JSONB;
  v_old JSONB;
  v_row JSONB;
  v_changes JSONB := '{}'::jsonb;
  v_action TEXT := lower(TG_OP);
  v_key TEXT;
  v_account_id UUID;
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_new := to_jsonb(NEW);
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_old := to_jsonb(OLD);
  END IF;
  v_row := COALESCE(v_new, v_old);
  v_account_id := (v_row ->> 'account_id')::uuid;

  -- Account being deleted (cascade): nothing to attribute the event to.
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = v_account_id) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'UPDATE' THEN
    FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
      -- Derived totals are already audited as the payment row that moved
      -- them; skipping them halves audit volume on busy ledgers.
      IF v_key NOT IN ('updated_at', 'paid_paise', 'credited_paise', 'outstanding_paise', 'has_message')
         AND (v_new -> v_key) IS DISTINCT FROM (v_old -> v_key) THEN
        v_changes := v_changes || jsonb_build_object(
          v_key, jsonb_build_object('from', v_old -> v_key, 'to', v_new -> v_key)
        );
      END IF;
    END LOOP;
    IF v_changes = '{}'::jsonb THEN
      RETURN NEW;
    END IF;
    IF TG_TABLE_NAME = 'invoice_payments'
       AND (v_old ->> 'voided_at') IS NULL AND (v_new ->> 'voided_at') IS NOT NULL THEN
      v_action := 'void';
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    -- The inserted row itself is the record; keep the key facts, not
    -- the free-text bodies (fits free-tier database sizes).
    v_changes := v_row - 'message' - 'summary' - 'internal_notes' - 'notes'
                       - 'account_id' - 'created_at' - 'updated_at' - 'has_message';
  ELSE
    -- DELETE: keep everything — the row is gone after this.
    v_changes := v_row;
  END IF;

  INSERT INTO audit_events (account_id, actor_user_id, entity_type, entity_id, action, changes)
  VALUES (v_account_id, auth.uid(), TG_TABLE_NAME, (v_row ->> 'id')::uuid, v_action, v_changes);

  RETURN COALESCE(NEW, OLD);
END;
$$;

ALTER FUNCTION public.apply_invoice_payment_totals() OWNER TO postgres;
ALTER FUNCTION public.record_audit_event() OWNER TO postgres;
-- Trigger-only definers: nobody should be able to call them directly.
REVOKE ALL ON FUNCTION public.apply_invoice_payment_totals() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_audit_event() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 8. Triggers
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS guard_invoice_write ON invoices;
CREATE TRIGGER guard_invoice_write
  BEFORE INSERT OR UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION public.guard_invoice_write();

DROP TRIGGER IF EXISTS guard_invoice_payment_write ON invoice_payments;
CREATE TRIGGER guard_invoice_payment_write
  BEFORE INSERT OR UPDATE ON invoice_payments
  FOR EACH ROW EXECUTE FUNCTION public.guard_invoice_payment_write();

DROP TRIGGER IF EXISTS apply_invoice_payment_totals ON invoice_payments;
CREATE TRIGGER apply_invoice_payment_totals
  AFTER INSERT OR UPDATE OR DELETE ON invoice_payments
  FOR EACH ROW EXECUTE FUNCTION public.apply_invoice_payment_totals();

DROP TRIGGER IF EXISTS guard_follow_up_write ON follow_ups;
CREATE TRIGGER guard_follow_up_write
  BEFORE INSERT OR UPDATE ON follow_ups
  FOR EACH ROW EXECUTE FUNCTION public.guard_follow_up_write();

DROP TRIGGER IF EXISTS audit_invoices ON invoices;
CREATE TRIGGER audit_invoices
  AFTER INSERT OR UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION public.record_audit_event();

DROP TRIGGER IF EXISTS audit_invoice_payments ON invoice_payments;
CREATE TRIGGER audit_invoice_payments
  AFTER INSERT OR UPDATE OR DELETE ON invoice_payments
  FOR EACH ROW EXECUTE FUNCTION public.record_audit_event();

DROP TRIGGER IF EXISTS audit_follow_ups ON follow_ups;
CREATE TRIGGER audit_follow_ups
  AFTER INSERT OR UPDATE OR DELETE ON follow_ups
  FOR EACH ROW EXECUTE FUNCTION public.record_audit_event();

-- ------------------------------------------------------------
-- 9. Row Level Security
--    viewer+ read · agent+ write operational data · admin+ delete invoices
-- ------------------------------------------------------------
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE follow_ups ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoices_select ON invoices;
DROP POLICY IF EXISTS invoices_insert ON invoices;
DROP POLICY IF EXISTS invoices_update ON invoices;
DROP POLICY IF EXISTS invoices_delete ON invoices;
CREATE POLICY invoices_select ON invoices FOR SELECT USING (is_account_member(account_id));
CREATE POLICY invoices_insert ON invoices FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY invoices_update ON invoices FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY invoices_delete ON invoices FOR DELETE USING (is_account_member(account_id, 'admin'));

-- Payments: no DELETE policy at all — void instead.
DROP POLICY IF EXISTS invoice_payments_select ON invoice_payments;
DROP POLICY IF EXISTS invoice_payments_insert ON invoice_payments;
DROP POLICY IF EXISTS invoice_payments_update ON invoice_payments;
CREATE POLICY invoice_payments_select ON invoice_payments FOR SELECT USING (is_account_member(account_id));
CREATE POLICY invoice_payments_insert ON invoice_payments FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY invoice_payments_update ON invoice_payments FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS follow_ups_select ON follow_ups;
DROP POLICY IF EXISTS follow_ups_insert ON follow_ups;
DROP POLICY IF EXISTS follow_ups_update ON follow_ups;
DROP POLICY IF EXISTS follow_ups_delete ON follow_ups;
CREATE POLICY follow_ups_select ON follow_ups FOR SELECT USING (is_account_member(account_id));
CREATE POLICY follow_ups_insert ON follow_ups FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY follow_ups_update ON follow_ups FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY follow_ups_delete ON follow_ups FOR DELETE USING (is_account_member(account_id, 'agent'));

-- Audit trail: members may read; nobody writes except the trigger.
DROP POLICY IF EXISTS audit_events_select ON audit_events;
CREATE POLICY audit_events_select ON audit_events FOR SELECT USING (is_account_member(account_id));

-- Defence in depth: the anon key never needs these tables.
REVOKE ALL ON invoices, invoice_payments, follow_ups, audit_events FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON audit_events FROM authenticated;

-- ------------------------------------------------------------
-- 10. redeem_invitation: guard the new account-scoped tables too.
--     Joining another account deletes the joiner's personal account;
--     it must refuse while that account still holds receivables data.
--     Body identical to 047 except the four new UNION ALL lines.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.redeem_invitation(
  p_token_hash TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_inv account_invitations%ROWTYPE;
  v_old_account_id UUID;
  v_old_account_owner UUID;
  v_has_other_members BOOLEAN;
  v_has_data BOOLEAN;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation has already been redeemed'
      USING ERRCODE = '22023';
  END IF;
  IF v_inv.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023';
  END IF;

  SELECT p.account_id, a.owner_user_id
  INTO v_old_account_id, v_old_account_owner
  FROM profiles p
  JOIN accounts a ON a.id = p.account_id
  WHERE p.user_id = v_caller_id
  FOR UPDATE OF p, a;

  IF v_old_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no profile' USING ERRCODE = '42501';
  END IF;

  IF v_old_account_id = v_inv.account_id THEN
    RAISE EXCEPTION 'You are already a member of this account'
      USING ERRCODE = '23505';
  END IF;

  IF v_old_account_owner <> v_caller_id THEN
    RAISE EXCEPTION 'You are already in a shared account; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE account_id = v_old_account_id
      AND user_id <> v_caller_id
  ) INTO v_has_other_members;

  IF v_has_other_members THEN
    RAISE EXCEPTION 'Your account has other members; remove them or transfer ownership before joining another account'
      USING ERRCODE = '23505';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM contacts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM conversations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM broadcasts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automation_logs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automation_pending_executions WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flows WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flow_runs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM pipelines WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM deals WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM message_templates WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM tags WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM custom_fields WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM contact_notes WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM whatsapp_config WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM api_keys WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM webhook_endpoints WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM quick_replies WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM notifications WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_configs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_knowledge_documents WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_knowledge_chunks WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_usage_log WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM invoices WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM invoice_payments WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM follow_ups WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM audit_events WHERE account_id = v_old_account_id
    LIMIT 1
  ) INTO v_has_data;
  IF v_has_data THEN
    RAISE EXCEPTION 'Your account already contains data; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;
  UPDATE profiles
  SET account_id = v_inv.account_id,
      account_role = v_inv.role
  WHERE user_id = v_caller_id;
  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;
  DELETE FROM accounts WHERE id = v_old_account_id;
  RETURN v_inv.account_id;
END;
$$;
ALTER FUNCTION public.redeem_invitation(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.redeem_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(TEXT) TO authenticated;
