-- ============================================================
-- PaisaFollow DEMO data — development / explicitly-requested demo
-- environments ONLY. Never run against a database with real customers.
--
-- Usage (after signing up once so your account exists):
--   psql "$DATABASE_URL" -v account_email='you@example.com' -f scripts/seed-demo.sql
--
-- Creates 6 demo customers (all named "DEMO …"), invoices across every
-- ageing bucket, partial payments, a credit note, a kept promise, a
-- missed promise and a dispute, all relative to today's date in India.
-- Re-running is safe: invoice numbers are unique per business, so a
-- second run inserts nothing new (ON CONFLICT DO NOTHING).
-- Remove it again with:  DELETE FROM contacts WHERE name LIKE 'DEMO %';
-- (after deleting the demo invoices: see the bottom of this file).
-- ============================================================
\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE demo_ctx ON COMMIT DROP AS
SELECT p.account_id, p.user_id, (now() AT TIME ZONE 'Asia/Kolkata')::date AS today
FROM profiles p
WHERE p.email = :'account_email'
LIMIT 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM demo_ctx) THEN
    RAISE EXCEPTION 'no profile found for that email — sign up in the app first';
  END IF;
END $$;

INSERT INTO contacts (user_id, account_id, name, company, phone)
SELECT c.user_id, c.account_id, d.name, d.company, d.phone
FROM demo_ctx c
CROSS JOIN (VALUES
  ('DEMO Ramesh Sharma', 'DEMO Sharma Electricals', '+919800000001'),
  ('DEMO Suresh Gupta',  'DEMO Gupta Hardware',     '+919800000002'),
  ('DEMO Anil Mehta',    'DEMO Mehta Paints',       '+919800000003'),
  ('DEMO Priya Iyer',    'DEMO Iyer Packaging',     '+919800000004'),
  ('DEMO Karan Singh',   'DEMO Singh Auto Parts',   '+919800000005'),
  ('DEMO Farah Khan',    'DEMO Khan Building Mart', '+919800000006')
) AS d(name, company, phone)
ON CONFLICT DO NOTHING;

CREATE TEMP TABLE demo_contacts ON COMMIT DROP AS
SELECT ct.id, ct.phone FROM contacts ct, demo_ctx c
WHERE ct.account_id = c.account_id AND ct.name LIKE 'DEMO %';

INSERT INTO invoices (account_id, contact_id, invoice_number, issue_date, due_date, total_paise, notes)
SELECT c.account_id, dc.id, v.num, c.today - v.issue_ago, c.today - v.due_ago, v.paise, 'Demo data'
FROM demo_ctx c
JOIN (VALUES
  ('DEMO-1001', '+919800000001', 75, 45, 12500000),
  ('DEMO-1002', '+919800000001', 20, 5,   3200000),
  ('DEMO-1003', '+919800000002', 40, 10,  4850050),
  ('DEMO-1004', '+919800000003', 100, 70, 9000000),
  ('DEMO-1005', '+919800000004', 10, -20, 2600000),
  ('DEMO-1006', '+919800000005', 35, 3,   1500000),
  ('DEMO-1007', '+919800000006', 60, 31,  6000000)
) AS v(num, phone, issue_ago, due_ago, paise) ON TRUE
JOIN demo_contacts dc ON dc.phone = v.phone
ON CONFLICT DO NOTHING;

-- Payments (the trigger maintains paid/outstanding totals).
INSERT INTO invoice_payments (account_id, invoice_id, kind, amount_paise, paid_on, method, reference)
SELECT c.account_id, i.id, v.kind, v.paise, c.today - v.ago, v.method, v.ref
FROM demo_ctx c
JOIN (VALUES
  ('DEMO-1001', 'payment',     2500000, 30, 'upi',           'UTR DEMO1'),
  ('DEMO-1003', 'payment',     1000000, 2,  'bank_transfer', 'NEFT DEMO2'),
  ('DEMO-1004', 'credit_note',  500000, 50, 'other',         'CN-DEMO-1'),
  ('DEMO-1006', 'payment',     1500000, 1,  'cash',          NULL)
) AS v(num, kind, paise, ago, method, ref) ON TRUE
JOIN invoices i ON i.account_id = c.account_id AND i.invoice_number = v.num
WHERE NOT EXISTS (SELECT 1 FROM invoice_payments p WHERE p.invoice_id = i.id);

-- Follow-ups: a missed promise, a kept one, a dispute, a scheduled call.
INSERT INTO follow_ups (account_id, contact_id, invoice_id, occurred_at, channel, status, summary, promise_date, promised_paise, dispute_reason, next_follow_up_on)
SELECT c.account_id, i.contact_id, i.id, now() - (v.ago || ' days')::interval, v.channel, v.status, v.summary,
       CASE WHEN v.promise_in IS NULL THEN NULL ELSE c.today + v.promise_in END, v.promised, v.dispute,
       CASE WHEN v.next_in IS NULL THEN NULL ELSE c.today + v.next_in END
FROM demo_ctx c
JOIN (VALUES
  ('DEMO-1001', 8, 'call',     'promise_to_pay', 'Ramesh ji promised part payment', -3,  5000000, NULL, NULL),
  ('DEMO-1003', 6, 'whatsapp', 'promise_to_pay', 'Will pay by NEFT',                -3,  1000000, NULL, NULL),
  ('DEMO-1004', 4, 'call',     'disputed',       'Says 5 bags were damaged',        NULL, NULL, 'Damaged goods in last lot', NULL),
  ('DEMO-1007', 2, 'call',     'customer_replied','Asked to call back',             NULL, NULL, NULL, 0)
) AS v(num, ago, channel, status, summary, promise_in, promised, dispute, next_in) ON TRUE
JOIN invoices i ON i.account_id = c.account_id AND i.invoice_number = v.num
WHERE NOT EXISTS (SELECT 1 FROM follow_ups f WHERE f.invoice_id = i.id);

SELECT count(*) AS demo_invoices, sum(outstanding_paise) / 100.0 AS demo_outstanding_inr
FROM invoices i, demo_ctx c
WHERE i.account_id = c.account_id AND i.invoice_number LIKE 'DEMO-%';

COMMIT;

-- To remove the demo data later (payments cannot be deleted by end users;
-- run as the database owner in the SQL editor):
--   DELETE FROM follow_ups       WHERE invoice_id IN (SELECT id FROM invoices WHERE invoice_number LIKE 'DEMO-%');
--   DELETE FROM invoice_payments WHERE invoice_id IN (SELECT id FROM invoices WHERE invoice_number LIKE 'DEMO-%');
--   DELETE FROM invoices         WHERE invoice_number LIKE 'DEMO-%';
--   DELETE FROM contacts         WHERE name LIKE 'DEMO %';
