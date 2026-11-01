/**
 * Daily follow-up queue — "whom do I call today, and why?"
 *
 * One item per customer (you phone a customer, not an invoice). Pure,
 * deterministic scoring from stored data; every point added is
 * reported back as a reason so the order is explainable. Nothing here
 * predicts whether a customer will pay.
 *
 * Score (higher = call first):
 *   + days overdue of the oldest overdue invoice (capped at 90)
 *   + 10 × log10(overdue rupees + 1)          ₹1,00,000 ≈ +50
 *   + 25 per missed promise (max 3)            history of broken promises
 *   + 40 when a promise falls due today
 *   + 30 when a scheduled follow-up is due     (next_follow_up_on ≤ today)
 *   + 20 when nobody has contacted them since the oldest invoice fell due
 *   − 40 when contacted in the last 2 days     (and nothing else is due)
 *   − 60 while the latest status is "disputed" (shown in a separate list)
 *
 * Customers whose latest follow-up schedules the next contact for a
 * future date are snoozed until then — unless a promise is due or
 * missed, which always resurfaces them.
 */
import { daysBetween, dateInTimeZone } from "./dates";
import { evaluatePromises, missedPromiseCounts, type EvaluatedPromise } from "./promises";
import { daysOverdue } from "./status";
import type { CustomerRow, FollowUpRow, InvoiceRow, PaymentRow } from "./types";

export type QueueReason =
  | { code: "overdue_days"; days: number }
  | { code: "overdue_amount"; paise: number; invoices: number }
  | { code: "missed_promises"; count: number }
  | { code: "promise_due_today"; paise: number }
  | { code: "promise_missed"; date: string; paise: number }
  | { code: "follow_up_due"; date: string }
  | { code: "never_contacted" }
  | { code: "recently_contacted"; days: number }
  | { code: "disputed"; reason: string | null };

export interface QueueItem {
  contactId: string;
  customer: CustomerRow | undefined;
  score: number;
  reasons: QueueReason[];
  overduePaise: number;
  outstandingPaise: number;
  maxDaysOverdue: number;
  overdueInvoiceIds: string[];
  missedPromises: number;
  lastFollowUp: FollowUpRow | null;
  disputed: boolean;
}

export interface QueueResult {
  /** Today's list, highest priority first. */
  items: QueueItem[];
  /** Customers with an active dispute — resolve, don't chase. */
  disputed: QueueItem[];
  /** Overdue customers snoozed by a future follow-up date. */
  snoozed: { contactId: string; until: string }[];
}

export interface QueueInputs {
  invoices: InvoiceRow[];
  payments: Pick<PaymentRow, "invoice_id" | "kind" | "amount_paise" | "paid_on" | "voided_at">[];
  followUps: FollowUpRow[];
  customers: CustomerRow[];
  today: string;
  timeZone: string;
  /** Only invoices in this currency are scored (no cross-currency sums). */
  currency: string;
}

const RECENT_CONTACT_DAYS = 2;

export function buildFollowUpQueue(input: QueueInputs): QueueResult {
  const { today, timeZone } = input;
  const invoices = input.invoices.filter((i) => i.currency === input.currency && i.status === "open");
  const customerById = new Map(input.customers.map((c) => [c.id, c]));

  const followUpsByContact = new Map<string, FollowUpRow[]>();
  for (const f of input.followUps) {
    const list = followUpsByContact.get(f.contact_id) ?? [];
    list.push(f);
    followUpsByContact.set(f.contact_id, list);
  }
  for (const list of followUpsByContact.values()) list.sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1));

  const promises = evaluatePromises({
    followUps: input.followUps,
    invoices,
    payments: input.payments,
    today,
    timeZone,
  });
  const missedCounts = missedPromiseCounts(promises);
  const actionablePromiseByContact = new Map<string, EvaluatedPromise>();
  for (const p of promises) {
    if (!p.isLatest || (p.state !== "due_today" && p.state !== "missed")) continue;
    actionablePromiseByContact.set(p.followUp.contact_id, p);
  }

  const invoicesByContact = new Map<string, InvoiceRow[]>();
  for (const inv of invoices) {
    if (inv.outstanding_paise <= 0) continue;
    const list = invoicesByContact.get(inv.contact_id) ?? [];
    list.push(inv);
    invoicesByContact.set(inv.contact_id, list);
  }

  const items: QueueItem[] = [];
  const disputed: QueueItem[] = [];
  const snoozed: QueueResult["snoozed"] = [];

  for (const [contactId, list] of invoicesByContact) {
    const overdue = list.filter((i) => daysOverdue(i, today) > 0);
    const outstandingPaise = list.reduce((s, i) => s + i.outstanding_paise, 0);
    const overduePaise = overdue.reduce((s, i) => s + i.outstanding_paise, 0);
    const maxDays = overdue.reduce((m, i) => Math.max(m, daysOverdue(i, today)), 0);
    const history = followUpsByContact.get(contactId) ?? [];
    const last = history[0] ?? null;
    const promise = actionablePromiseByContact.get(contactId);
    const scheduledDue = last?.next_follow_up_on && last.next_follow_up_on <= today ? last.next_follow_up_on : null;
    const snoozedUntil = last?.next_follow_up_on && last.next_follow_up_on > today ? last.next_follow_up_on : null;

    if (overdue.length === 0 && !promise && !scheduledDue) continue;
    if (snoozedUntil && !promise) {
      snoozed.push({ contactId, until: snoozedUntil });
      continue;
    }

    const reasons: QueueReason[] = [];
    let score = 0;

    if (maxDays > 0) {
      score += Math.min(maxDays, 90);
      reasons.push({ code: "overdue_days", days: maxDays });
      score += 10 * Math.log10(overduePaise / 100 + 1);
      reasons.push({ code: "overdue_amount", paise: overduePaise, invoices: overdue.length });
    }

    const missed = missedCounts.get(contactId) ?? 0;
    if (missed > 0) {
      score += 25 * Math.min(missed, 3);
      reasons.push({ code: "missed_promises", count: missed });
    }

    if (promise?.state === "due_today") {
      score += 40;
      reasons.push({ code: "promise_due_today", paise: promise.promisedPaise });
    } else if (promise?.state === "missed") {
      reasons.push({
        code: "promise_missed",
        date: promise.followUp.promise_date as string,
        paise: promise.promisedPaise,
      });
    }

    if (scheduledDue) {
      score += 30;
      reasons.push({ code: "follow_up_due", date: scheduledDue });
    }

    const oldestDue = overdue.reduce<string | null>((d, i) => (d === null || i.due_date < d ? i.due_date : d), null);
    const contactedSinceDue = oldestDue
      ? history.some((f) => dateInTimeZone(f.occurred_at, timeZone) >= oldestDue)
      : history.length > 0;
    if (overdue.length > 0 && !contactedSinceDue) {
      score += 20;
      reasons.push({ code: "never_contacted" });
    }

    if (last && !promise && !scheduledDue) {
      const daysSince = daysBetween(dateInTimeZone(last.occurred_at, timeZone), today);
      if (daysSince <= RECENT_CONTACT_DAYS) {
        score -= 40;
        reasons.push({ code: "recently_contacted", days: daysSince });
      }
    }

    const isDisputed = last?.status === "disputed";
    if (isDisputed) {
      score -= 60;
      reasons.push({ code: "disputed", reason: last?.dispute_reason ?? null });
    }

    const item: QueueItem = {
      contactId,
      customer: customerById.get(contactId),
      score: Math.round(score * 10) / 10,
      reasons,
      overduePaise,
      outstandingPaise,
      maxDaysOverdue: maxDays,
      overdueInvoiceIds: overdue.map((i) => i.id),
      missedPromises: missed,
      lastFollowUp: last,
      disputed: isDisputed,
    };
    (isDisputed ? disputed : items).push(item);
  }

  const byPriority = (a: QueueItem, b: QueueItem) =>
    b.score - a.score || b.overduePaise - a.overduePaise || a.contactId.localeCompare(b.contactId);
  items.sort(byPriority);
  disputed.sort(byPriority);
  snoozed.sort((a, b) => a.until.localeCompare(b.until));
  return { items, disputed, snoozed };
}
