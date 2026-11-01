/**
 * CSV exports (also the "export my data" feature). Text cells go
 * through toCsv's formula-injection defence; amounts are written as
 * plain decimal numbers so spreadsheets can sum them.
 */
import { toCsv, type CsvCell } from "./csv";
import { daysOverdue, paymentState } from "./status";
import { paiseToDecimalString } from "./money";
import { customerBalances } from "./overview";
import { agingBucket } from "./status";
import type { CustomerRow, FollowUpRow, InvoiceRow, PaymentRow } from "./types";

const amount = (paise: number | null | undefined): CsvCell => (paise === null || paise === undefined ? "" : Number(paiseToDecimalString(paise)));

export interface ExportData {
  invoices: InvoiceRow[];
  payments: PaymentRow[];
  followUps: FollowUpRow[];
  customers: Map<string, CustomerRow>;
  today: string;
  currency: string;
}

const name = (d: ExportData, contactId: string) => {
  const c = d.customers.get(contactId);
  return c?.company || c?.name || c?.phone || "";
};

export function invoicesCsv(d: ExportData): string {
  const rows: CsvCell[][] = [
    ["Invoice No", "Customer", "Phone", "Invoice Date", "Due Date", "Currency", "Total", "Paid", "Credited", "Outstanding", "Status", "Days Overdue", "Notes"],
  ];
  for (const i of d.invoices) {
    rows.push([
      i.invoice_number,
      name(d, i.contact_id),
      d.customers.get(i.contact_id)?.phone ?? "",
      i.issue_date,
      i.due_date,
      i.currency,
      amount(i.total_paise),
      amount(i.paid_paise),
      amount(i.credited_paise),
      amount(i.outstanding_paise),
      paymentState(i),
      daysOverdue(i, d.today),
      i.notes ?? "",
    ]);
  }
  return toCsv(rows);
}

export function paymentsCsv(d: ExportData): string {
  const inv = new Map(d.invoices.map((i) => [i.id, i]));
  const rows: CsvCell[][] = [["Date", "Invoice No", "Customer", "Type", "Method", "Amount", "Reference", "Notes", "Voided At", "Void Reason"]];
  for (const p of d.payments) {
    const i = inv.get(p.invoice_id);
    rows.push([
      p.paid_on,
      i?.invoice_number ?? "",
      i ? name(d, i.contact_id) : "",
      p.kind,
      p.method,
      amount(p.amount_paise),
      p.reference ?? "",
      p.notes ?? "",
      p.voided_at ?? "",
      p.void_reason ?? "",
    ]);
  }
  return toCsv(rows);
}

export function followUpsCsv(d: ExportData): string {
  const inv = new Map(d.invoices.map((i) => [i.id, i]));
  const rows: CsvCell[][] = [
    ["When", "Customer", "Invoice No", "Channel", "Status", "Summary", "Next Follow-up", "Promise Date", "Promised Amount", "Dispute Reason", "Message", "Internal Notes"],
  ];
  for (const f of d.followUps) {
    rows.push([
      f.occurred_at,
      name(d, f.contact_id),
      f.invoice_id ? (inv.get(f.invoice_id)?.invoice_number ?? "") : "",
      f.channel,
      f.status,
      f.summary ?? "",
      f.next_follow_up_on ?? "",
      f.promise_date ?? "",
      amount(f.promised_paise),
      f.dispute_reason ?? "",
      f.message ?? "",
      f.internal_notes ?? "",
    ]);
  }
  return toCsv(rows);
}

export function customersCsv(d: ExportData): string {
  const balances = customerBalances(d.invoices, d.payments, d.followUps, d.today, d.currency);
  const rows: CsvCell[][] = [["Customer", "Contact Name", "Phone", "Email", "Outstanding", "Overdue", "Last Payment", "Next Follow-up"]];
  for (const [id, c] of d.customers) {
    const b = balances.get(id);
    rows.push([c.company ?? "", c.name ?? "", c.phone, c.email ?? "", amount(b?.outstandingPaise ?? 0), amount(b?.overduePaise ?? 0), b?.lastPaymentOn ?? "", b?.nextFollowUpOn ?? ""]);
  }
  return toCsv(rows);
}

export interface AgingRow {
  contactId: string;
  current: number;
  d1_7: number;
  d8_30: number;
  d31_plus: number;
  total: number;
}

export function agingByCustomer(d: ExportData): AgingRow[] {
  const map = new Map<string, AgingRow>();
  for (const i of d.invoices) {
    if (i.status !== "open" || i.outstanding_paise <= 0 || i.currency !== d.currency) continue;
    const row = map.get(i.contact_id) ?? { contactId: i.contact_id, current: 0, d1_7: 0, d8_30: 0, d31_plus: 0, total: 0 };
    row[agingBucket(daysOverdue(i, d.today))] += i.outstanding_paise;
    row.total += i.outstanding_paise;
    map.set(i.contact_id, row);
  }
  return [...map.values()].sort((a, b) => b.d31_plus - a.d31_plus || b.total - a.total);
}

export function agingCsv(d: ExportData): string {
  const rows: CsvCell[][] = [["Customer", "Not yet due", "1-7 days", "8-30 days", "31+ days", "Total outstanding"]];
  for (const r of agingByCustomer(d)) {
    rows.push([name(d, r.contactId), amount(r.current), amount(r.d1_7), amount(r.d8_30), amount(r.d31_plus), amount(r.total)]);
  }
  return toCsv(rows);
}
