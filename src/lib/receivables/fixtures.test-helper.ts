import type { CustomerRow, FollowUpRow, InvoiceRow, PaymentRow } from "./types";

let seq = 0;
const id = (prefix: string) => `${prefix}-${++seq}`;

export function makeInvoice(p: Partial<InvoiceRow> = {}): InvoiceRow {
  const total = p.total_paise ?? 10_000_00;
  const paid = p.paid_paise ?? 0;
  const credited = p.credited_paise ?? 0;
  const status = p.status ?? "open";
  return {
    id: id("inv"),
    account_id: "acc-1",
    contact_id: "c-1",
    invoice_number: `INV-${seq}`,
    issue_date: "2026-09-01",
    due_date: "2026-10-01",
    currency: "INR",
    notes: null,
    cancelled_at: null,
    cancel_reason: null,
    source: "manual",
    created_by: null,
    created_at: "2026-09-01T05:00:00Z",
    updated_at: "2026-09-01T05:00:00Z",
    ...p,
    total_paise: total,
    paid_paise: paid,
    credited_paise: credited,
    status,
    outstanding_paise: p.outstanding_paise ?? (status === "cancelled" ? 0 : total - paid - credited),
  };
}

export function makePayment(p: Partial<PaymentRow> & Pick<PaymentRow, "invoice_id">): PaymentRow {
  return {
    id: id("pay"),
    account_id: "acc-1",
    kind: "payment",
    amount_paise: 1000_00,
    paid_on: "2026-10-15",
    method: "upi",
    reference: null,
    notes: null,
    client_ref: null,
    voided_at: null,
    void_reason: null,
    voided_by: null,
    recorded_by: null,
    created_at: "2026-10-15T06:00:00Z",
    ...p,
  };
}

export function makeFollowUp(p: Partial<FollowUpRow> = {}): FollowUpRow {
  return {
    id: id("fu"),
    account_id: "acc-1",
    contact_id: "c-1",
    invoice_id: null,
    occurred_at: "2026-10-20T06:00:00Z",
    channel: "whatsapp",
    status: "reminder_sent",
    summary: null,
    message: null,
    has_message: false,
    next_follow_up_on: null,
    promise_date: null,
    promised_paise: null,
    dispute_reason: null,
    internal_notes: null,
    client_ref: null,
    recorded_by: null,
    created_at: "2026-10-20T06:00:00Z",
    updated_at: "2026-10-20T06:00:00Z",
    ...p,
  };
}

export function makeCustomer(p: Partial<CustomerRow> & Pick<CustomerRow, "id">): CustomerRow {
  return { name: `Customer ${p.id}`, phone: "", phone_normalized: "", email: null, company: null, ...p };
}
