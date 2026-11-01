/**
 * Derived invoice state. Nothing here is stored: payment state comes
 * from the trigger-maintained totals, overdue-ness from the due date
 * versus "today" in the business timezone.
 */
import { daysBetween } from "./dates";
import type { InvoiceRow } from "./types";

export type PaymentState = "cancelled" | "paid" | "partially_paid" | "unpaid";

type InvoiceAmounts = Pick<
  InvoiceRow,
  "status" | "total_paise" | "paid_paise" | "credited_paise" | "outstanding_paise" | "due_date"
>;

export function paymentState(inv: InvoiceAmounts): PaymentState {
  if (inv.status === "cancelled") return "cancelled";
  if (inv.outstanding_paise <= 0) return "paid";
  if (inv.paid_paise + inv.credited_paise > 0) return "partially_paid";
  return "unpaid";
}

/** Days past due (0 when not yet due, settled, or cancelled). */
export function daysOverdue(inv: InvoiceAmounts, today: string): number {
  if (inv.status === "cancelled" || inv.outstanding_paise <= 0) return 0;
  return Math.max(0, daysBetween(inv.due_date, today));
}

export function isOverdue(inv: InvoiceAmounts, today: string): boolean {
  return daysOverdue(inv, today) > 0;
}

export type AgingBucket = "current" | "d1_7" | "d8_30" | "d31_plus";

export function agingBucket(days: number): AgingBucket {
  if (days <= 0) return "current";
  if (days <= 7) return "d1_7";
  if (days <= 30) return "d8_30";
  return "d31_plus";
}

/** Combined label key for lists: e.g. partially_paid + overdue. */
export interface InvoiceBadge {
  state: PaymentState;
  overdueDays: number;
}

export function invoiceBadge(inv: InvoiceAmounts, today: string): InvoiceBadge {
  return { state: paymentState(inv), overdueDays: daysOverdue(inv, today) };
}
