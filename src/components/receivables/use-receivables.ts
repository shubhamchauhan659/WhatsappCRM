"use client";

/**
 * Loads the account's receivables snapshot (business profile, invoices,
 * payments, follow-ups and the customers they reference) through the
 * browser Supabase client — row level security scopes every query to
 * the signed-in user's business.
 *
 * Stale-while-revalidate: switching between receivables screens shows
 * the last snapshot instantly and refreshes it in the background.
 * Sized for small businesses (thousands of invoices); see
 * docs/ARCHITECTURE.md for the scale-out path.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fetchAllInChunks, fetchAllPages } from "@/lib/supabase/paged-query";
import { useAuth } from "@/hooks/use-auth";
import { DEFAULT_TIMEZONE, todayInTimeZone } from "@/lib/receivables/dates";
import {
  BUSINESS_PROFILE_COLUMNS,
  CUSTOMER_COLUMNS,
  FOLLOW_UP_COLUMNS,
  INVOICE_COLUMNS,
  PAYMENT_COLUMNS,
  type BusinessProfile,
  type CustomerRow,
  type FollowUpRow,
  type InvoiceRow,
  type PaymentRow,
} from "@/lib/receivables/types";

export interface ReceivablesSnapshot {
  business: BusinessProfile;
  invoices: InvoiceRow[];
  payments: PaymentRow[];
  followUps: FollowUpRow[];
  customers: Map<string, CustomerRow>;
  today: string;
  timeZone: string;
  currency: string;
}

let cache: { accountId: string; data: ReceivablesSnapshot } | null = null;

/** BIGINT columns arrive as JSON numbers; coerce defensively. */
const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));

async function loadSnapshot(accountId: string): Promise<ReceivablesSnapshot> {
  const supabase = createClient();
  const { data: business, error: bizErr } = await supabase
    .from("accounts")
    .select(BUSINESS_PROFILE_COLUMNS)
    .eq("id", accountId)
    .single();
  if (bizErr || !business) throw new Error(bizErr?.message ?? "account not found");

  const [invoices, payments, followUps] = await Promise.all([
    fetchAllPages<InvoiceRow>((from, to) =>
      supabase.from("invoices").select(INVOICE_COLUMNS).eq("account_id", accountId).order("due_date").order("id").range(from, to),
    ),
    fetchAllPages<PaymentRow>((from, to) =>
      supabase.from("invoice_payments").select(PAYMENT_COLUMNS).eq("account_id", accountId).order("paid_on").order("id").range(from, to),
    ),
    fetchAllPages<FollowUpRow>((from, to) =>
      supabase.from("follow_ups").select(FOLLOW_UP_COLUMNS).eq("account_id", accountId).order("occurred_at").order("id").range(from, to),
    ),
  ]);

  const contactIds = [...new Set([...invoices.map((i) => i.contact_id), ...followUps.map((f) => f.contact_id)])];
  const customers = await fetchAllInChunks<CustomerRow, string>(contactIds, (slice, from, to) =>
    supabase.from("contacts").select(CUSTOMER_COLUMNS).in("id", slice).order("id").range(from, to),
  );

  const biz = business as BusinessProfile;
  const timeZone = biz.timezone || DEFAULT_TIMEZONE;
  return {
    business: biz,
    invoices: invoices.map((i) => ({
      ...i,
      total_paise: num(i.total_paise),
      paid_paise: num(i.paid_paise),
      credited_paise: num(i.credited_paise),
      outstanding_paise: num(i.outstanding_paise),
    })),
    payments: payments.map((p) => ({ ...p, amount_paise: num(p.amount_paise) })),
    followUps: followUps.map((f) => ({ ...f, promised_paise: f.promised_paise === null ? null : num(f.promised_paise) })),
    customers: new Map(customers.map((c) => [c.id, c])),
    today: todayInTimeZone(timeZone),
    timeZone,
    currency: biz.default_currency || "INR",
  };
}

export type ReceivablesState =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: ReceivablesSnapshot; error: null; refreshing: boolean }
  | { status: "error"; data: ReceivablesSnapshot | null; error: string };

export function useReceivables(): ReceivablesState & { reload: () => Promise<void> } {
  const { accountId, profileLoading } = useAuth();
  const [state, setState] = useState<ReceivablesState>(() =>
    cache && cache.accountId === accountId
      ? { status: "ready", data: cache.data, error: null, refreshing: true }
      : { status: "loading", data: null, error: null },
  );
  const seq = useRef(0);

  const reload = useCallback(async () => {
    if (!accountId) return;
    const mine = ++seq.current;
    setState((s) => (s.data ? { status: "ready", data: s.data, error: null, refreshing: true } : s));
    try {
      const data = await loadSnapshot(accountId);
      if (mine !== seq.current) return;
      cache = { accountId, data };
      setState({ status: "ready", data, error: null, refreshing: false });
    } catch (err) {
      if (mine !== seq.current) return;
      const message = err instanceof Error ? err.message : String(err);
      setState((s) => ({ status: "error", data: s.data, error: message }));
    }
  }, [accountId]);

  useEffect(() => {
    if (profileLoading || !accountId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch; state is set after await
    void reload();
  }, [profileLoading, accountId, reload]);

  return { ...state, reload };
}

/** Drop the cached snapshot (e.g. after sign-out or account deletion). */
export function clearReceivablesCache(): void {
  cache = null;
}

/** RFC 4122 v4 id for idempotent retries (client_ref). */
export function newClientRef(): string {
  return crypto.randomUUID();
}
