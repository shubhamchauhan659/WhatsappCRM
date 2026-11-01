/**
 * Row shapes for the receivables tables (migration 060). Money is
 * always integer paise. Dates are ISO `YYYY-MM-DD` strings; timestamps
 * are ISO strings as returned by PostgREST.
 */

export type InvoiceLifecycle = "open" | "cancelled";

export interface InvoiceRow {
  id: string;
  account_id: string;
  contact_id: string;
  invoice_number: string;
  issue_date: string;
  due_date: string;
  currency: string;
  total_paise: number;
  paid_paise: number;
  credited_paise: number;
  outstanding_paise: number;
  status: InvoiceLifecycle;
  notes: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  source: "manual" | "import" | "api";
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type PaymentKind = "payment" | "credit_note";
export const PAYMENT_METHODS = ["upi", "bank_transfer", "cash", "cheque", "card", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface PaymentRow {
  id: string;
  account_id: string;
  invoice_id: string;
  kind: PaymentKind;
  amount_paise: number;
  paid_on: string;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
  client_ref: string | null;
  voided_at: string | null;
  void_reason: string | null;
  voided_by: string | null;
  recorded_by: string | null;
  created_at: string;
}

export const FOLLOW_UP_CHANNELS = ["whatsapp", "call", "sms", "email", "in_person", "other"] as const;
export type FollowUpChannel = (typeof FOLLOW_UP_CHANNELS)[number];

export const FOLLOW_UP_STATUSES = [
  "not_contacted",
  "reminder_drafted",
  "reminder_sent",
  "customer_replied",
  "promise_to_pay",
  "disputed",
  "partially_paid",
  "paid",
  "follow_up_required",
] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

export interface FollowUpRow {
  id: string;
  account_id: string;
  contact_id: string;
  invoice_id: string | null;
  occurred_at: string;
  channel: FollowUpChannel;
  status: FollowUpStatus;
  summary: string | null;
  /** Not part of list snapshots (see FOLLOW_UP_COLUMNS); load with FOLLOW_UP_MESSAGE_COLUMNS. */
  message?: string | null;
  /** True when a sent-message body is stored (generated column). */
  has_message: boolean;
  next_follow_up_on: string | null;
  promise_date: string | null;
  promised_paise: number | null;
  dispute_reason: string | null;
  internal_notes: string | null;
  client_ref: string | null;
  recorded_by: string | null;
  created_at: string;
  updated_at: string;
}

/** The subset of `contacts` the receivables screens need. */
export interface CustomerRow {
  id: string;
  name: string | null;
  phone: string;
  phone_normalized?: string | null;
  email: string | null;
  company: string | null;
}

export interface BusinessProfile {
  id: string;
  name: string;
  default_currency: string;
  timezone: string;
  business_address: string | null;
  business_phone: string | null;
  business_email: string | null;
  business_gstin: string | null;
  business_upi_id: string | null;
  business_logo_url: string | null;
}

export const BUSINESS_PROFILE_COLUMNS =
  "id, name, default_currency, timezone, business_address, business_phone, business_email, business_gstin, business_upi_id, business_logo_url";

export const INVOICE_COLUMNS =
  "id, account_id, contact_id, invoice_number, issue_date, due_date, currency, total_paise, paid_paise, credited_paise, outstanding_paise, status, notes, cancelled_at, cancel_reason, source, created_by, created_at, updated_at";

export const PAYMENT_COLUMNS =
  "id, account_id, invoice_id, kind, amount_paise, paid_on, method, reference, notes, client_ref, voided_at, void_reason, voided_by, recorded_by, created_at";

/** List/snapshot columns — deliberately without the message body (egress). */
export const FOLLOW_UP_COLUMNS =
  "id, account_id, contact_id, invoice_id, occurred_at, channel, status, summary, has_message, next_follow_up_on, promise_date, promised_paise, dispute_reason, internal_notes, client_ref, recorded_by, created_at, updated_at";

export const FOLLOW_UP_MESSAGE_COLUMNS = "id, message";

export const CUSTOMER_COLUMNS = "id, name, phone, phone_normalized, email, company";

/** Display name for a contact used as a customer. */
export function customerDisplayName(c: Pick<CustomerRow, "name" | "company" | "phone"> | undefined | null): string {
  if (!c) return "—";
  const name = c.name?.trim();
  const company = c.company?.trim();
  if (name && company && name.toLowerCase() !== company.toLowerCase()) return `${company} (${name})`;
  return company || name || c.phone || "—";
}
