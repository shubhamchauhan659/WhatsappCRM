/**
 * Promise-to-pay evaluation — deterministic, computed on read.
 *
 * A promise is a follow-up with status `promise_to_pay`, a promise
 * date and an amount. Its scope is the invoice it names, or every
 * invoice of the customer when it is customer-level. Against that
 * scope we sum real payments (not credit notes, not voided) received
 * on or after the day the promise was made:
 *
 *   settled   – the scope owes nothing any more
 *   kept      – payments since the promise cover the promised amount
 *   pending   – promise date still in the future
 *   due_today – promise date is today
 *   missed    – promise date has passed and it was not kept
 *
 * Because "missed" depends only on stored rows and today's date, a
 * missed promise appears in the queue automatically the next morning
 * without any scheduled job.
 */
import { dateInTimeZone } from "./dates";
import type { FollowUpRow, InvoiceRow, PaymentRow } from "./types";

export type PromiseState = "settled" | "kept" | "pending" | "due_today" | "missed";

export interface EvaluatedPromise {
  followUp: FollowUpRow;
  state: PromiseState;
  promisedPaise: number;
  paidSincePaise: number;
  /** Outstanding on the promise's scope right now. */
  scopeOutstandingPaise: number;
  /**
   * False once any later follow-up exists for the same customer — the
   * promise has been acted on, so it should no longer drive the queue
   * (it still counts towards the customer's missed-promise history).
   */
  isLatest: boolean;
}

export interface PromiseInputs {
  followUps: FollowUpRow[];
  invoices: Pick<InvoiceRow, "id" | "contact_id" | "outstanding_paise" | "status">[];
  payments: Pick<PaymentRow, "invoice_id" | "kind" | "amount_paise" | "paid_on" | "voided_at">[];
  today: string;
  timeZone: string;
}

export function evaluatePromises({ followUps, invoices, payments, today, timeZone }: PromiseInputs): EvaluatedPromise[] {
  const invoiceById = new Map(invoices.map((i) => [i.id, i]));
  const invoiceIdsByContact = new Map<string, string[]>();
  for (const inv of invoices) {
    const list = invoiceIdsByContact.get(inv.contact_id) ?? [];
    list.push(inv.id);
    invoiceIdsByContact.set(inv.contact_id, list);
  }
  const paymentsByInvoice = new Map<string, typeof payments>();
  for (const p of payments) {
    if (p.voided_at || p.kind !== "payment") continue;
    const list = paymentsByInvoice.get(p.invoice_id) ?? [];
    list.push(p);
    paymentsByInvoice.set(p.invoice_id, list);
  }
  const latestByContact = new Map<string, string>();
  for (const f of followUps) {
    const prev = latestByContact.get(f.contact_id);
    if (!prev || f.occurred_at > prev) latestByContact.set(f.contact_id, f.occurred_at);
  }

  const out: EvaluatedPromise[] = [];
  for (const f of followUps) {
    if (f.status !== "promise_to_pay" || !f.promise_date || !f.promised_paise) continue;
    const scope = f.invoice_id ? [f.invoice_id] : (invoiceIdsByContact.get(f.contact_id) ?? []);
    const madeOn = dateInTimeZone(f.occurred_at, timeZone);

    let scopeOutstanding = 0;
    let paidSince = 0;
    for (const id of scope) {
      const inv = invoiceById.get(id);
      if (inv && inv.status !== "cancelled") scopeOutstanding += Math.max(0, inv.outstanding_paise);
      for (const p of paymentsByInvoice.get(id) ?? []) {
        if (p.paid_on >= madeOn) paidSince += p.amount_paise;
      }
    }

    let state: PromiseState;
    if (scopeOutstanding <= 0) state = "settled";
    else if (paidSince >= f.promised_paise) state = "kept";
    else if (today < f.promise_date) state = "pending";
    else if (today === f.promise_date) state = "due_today";
    else state = "missed";

    out.push({
      followUp: f,
      state,
      promisedPaise: f.promised_paise,
      paidSincePaise: paidSince,
      scopeOutstandingPaise: scopeOutstanding,
      isLatest: latestByContact.get(f.contact_id) === f.occurred_at,
    });
  }
  return out;
}

/** Count of missed promises per customer (full history). */
export function missedPromiseCounts(evaluated: EvaluatedPromise[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of evaluated) {
    if (e.state !== "missed") continue;
    counts.set(e.followUp.contact_id, (counts.get(e.followUp.contact_id) ?? 0) + 1);
  }
  return counts;
}
