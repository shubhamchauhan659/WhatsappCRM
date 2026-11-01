/**
 * Receivables dashboard figures. Every number is a sum over stored
 * invoice/payment rows — nothing is estimated or generated.
 */
import { dateInTimeZone } from "./dates";
import { evaluatePromises, type EvaluatedPromise } from "./promises";
import { agingBucket, daysOverdue, type AgingBucket } from "./status";
import type { FollowUpRow, InvoiceRow, PaymentRow } from "./types";

export interface CustomerBalance {
  contactId: string;
  outstandingPaise: number;
  overduePaise: number;
  maxDaysOverdue: number;
  openInvoices: number;
  overdueInvoices: number;
  lastPaymentOn: string | null;
  nextFollowUpOn: string | null;
}

export interface ReceivablesOverview {
  currency: string;
  outstandingPaise: number;
  overduePaise: number;
  aging: Record<AgingBucket, number>;
  openInvoiceCount: number;
  overdueInvoiceCount: number;
  /** Open invoices in other currencies — excluded from the sums above. */
  otherCurrencyInvoiceCount: number;
  topOverdueCustomers: CustomerBalance[];
  followUpsDueToday: FollowUpRow[];
  overdueWithoutFollowUp: InvoiceRow[];
  promisesDueOrMissed: EvaluatedPromise[];
  recentPayments: PaymentRow[];
  recentFollowUps: FollowUpRow[];
}

export interface OverviewInputs {
  invoices: InvoiceRow[];
  payments: PaymentRow[];
  followUps: FollowUpRow[];
  today: string;
  timeZone: string;
  currency: string;
  topN?: number;
  recentN?: number;
}

export function customerBalances(
  invoices: InvoiceRow[],
  payments: Pick<PaymentRow, "invoice_id" | "kind" | "paid_on" | "voided_at">[],
  followUps: FollowUpRow[],
  today: string,
  currency: string,
): Map<string, CustomerBalance> {
  const balances = new Map<string, CustomerBalance>();
  const contactByInvoice = new Map<string, string>();
  const get = (contactId: string): CustomerBalance => {
    let b = balances.get(contactId);
    if (!b) {
      b = {
        contactId,
        outstandingPaise: 0,
        overduePaise: 0,
        maxDaysOverdue: 0,
        openInvoices: 0,
        overdueInvoices: 0,
        lastPaymentOn: null,
        nextFollowUpOn: null,
      };
      balances.set(contactId, b);
    }
    return b;
  };

  for (const inv of invoices) {
    contactByInvoice.set(inv.id, inv.contact_id);
    if (inv.currency !== currency || inv.status !== "open" || inv.outstanding_paise <= 0) continue;
    const b = get(inv.contact_id);
    b.outstandingPaise += inv.outstanding_paise;
    b.openInvoices += 1;
    const d = daysOverdue(inv, today);
    if (d > 0) {
      b.overduePaise += inv.outstanding_paise;
      b.overdueInvoices += 1;
      b.maxDaysOverdue = Math.max(b.maxDaysOverdue, d);
    }
  }
  for (const p of payments) {
    if (p.voided_at || p.kind !== "payment") continue;
    const contactId = contactByInvoice.get(p.invoice_id);
    if (!contactId) continue;
    const b = get(contactId);
    if (!b.lastPaymentOn || p.paid_on > b.lastPaymentOn) b.lastPaymentOn = p.paid_on;
  }
  // Next follow-up = the date set on the customer's latest follow-up.
  const latest = new Map<string, FollowUpRow>();
  for (const f of followUps) {
    const prev = latest.get(f.contact_id);
    if (!prev || f.occurred_at > prev.occurred_at) latest.set(f.contact_id, f);
  }
  for (const [contactId, f] of latest) {
    if (f.next_follow_up_on) get(contactId).nextFollowUpOn = f.next_follow_up_on;
  }
  return balances;
}

export function buildOverview(input: OverviewInputs): ReceivablesOverview {
  const { today, timeZone, currency } = input;
  const topN = input.topN ?? 5;
  const recentN = input.recentN ?? 8;

  const open = input.invoices.filter((i) => i.status === "open" && i.outstanding_paise > 0);
  const inCurrency = open.filter((i) => i.currency === currency);
  const aging: Record<AgingBucket, number> = { current: 0, d1_7: 0, d8_30: 0, d31_plus: 0 };
  let outstanding = 0;
  let overdue = 0;
  let overdueCount = 0;
  for (const inv of inCurrency) {
    outstanding += inv.outstanding_paise;
    const d = daysOverdue(inv, today);
    aging[agingBucket(d)] += inv.outstanding_paise;
    if (d > 0) {
      overdue += inv.outstanding_paise;
      overdueCount += 1;
    }
  }

  const balances = customerBalances(input.invoices, input.payments, input.followUps, today, currency);
  const topOverdueCustomers = [...balances.values()]
    .filter((b) => b.overduePaise > 0)
    .sort((a, b) => b.overduePaise - a.overduePaise || b.maxDaysOverdue - a.maxDaysOverdue)
    .slice(0, topN);

  // Follow-ups due today: the latest follow-up per customer schedules today or earlier,
  // and that customer still owes money.
  const latestByContact = new Map<string, FollowUpRow>();
  for (const f of input.followUps) {
    const prev = latestByContact.get(f.contact_id);
    if (!prev || f.occurred_at > prev.occurred_at) latestByContact.set(f.contact_id, f);
  }
  const followUpsDueToday = [...latestByContact.values()]
    .filter((f) => f.next_follow_up_on && f.next_follow_up_on <= today)
    .filter((f) => (balances.get(f.contact_id)?.outstandingPaise ?? 0) > 0)
    .sort((a, b) => (a.next_follow_up_on as string).localeCompare(b.next_follow_up_on as string));

  // Overdue invoices nobody has followed up on since they fell due.
  const overdueWithoutFollowUp = inCurrency
    .filter((inv) => daysOverdue(inv, today) > 0)
    .filter(
      (inv) =>
        !input.followUps.some(
          (f) =>
            f.contact_id === inv.contact_id &&
            (f.invoice_id === inv.id || f.invoice_id === null) &&
            dateInTimeZone(f.occurred_at, timeZone) >= inv.due_date,
        ),
    )
    .sort((a, b) => a.due_date.localeCompare(b.due_date));

  const promisesDueOrMissed = evaluatePromises({
    followUps: input.followUps,
    invoices: input.invoices,
    payments: input.payments,
    today,
    timeZone,
  })
    .filter((p) => p.isLatest && (p.state === "due_today" || p.state === "missed"))
    .sort((a, b) => (a.followUp.promise_date as string).localeCompare(b.followUp.promise_date as string));

  const recentPayments = input.payments
    .filter((p) => !p.voided_at)
    .sort((a, b) => b.paid_on.localeCompare(a.paid_on) || b.created_at.localeCompare(a.created_at))
    .slice(0, recentN);
  const recentFollowUps = [...input.followUps]
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
    .slice(0, recentN);

  return {
    currency,
    outstandingPaise: outstanding,
    overduePaise: overdue,
    aging,
    openInvoiceCount: inCurrency.length,
    overdueInvoiceCount: overdueCount,
    otherCurrencyInvoiceCount: open.length - inCurrency.length,
    topOverdueCustomers,
    followUpsDueToday,
    overdueWithoutFollowUp,
    promisesDueOrMissed,
    recentPayments,
    recentFollowUps,
  };
}
