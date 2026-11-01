/**
 * Invoice CSV import — validation and planning (no I/O).
 *
 * Designed for what Indian SMBs actually have: an Excel sheet or a
 * Tally / Busy / Vyapar "outstanding" export. Headers are matched by
 * common aliases; amounts accept ₹ / Rs / Indian grouping; dates are
 * day-first.
 *
 * Duplicates are surfaced, never silently merged:
 *   - same phone as an existing customer  → linked (phone is the
 *     account's unique customer key, so this is the same customer)
 *   - same name, no phone in the file     → "possible duplicate"; linked
 *     only if the user leaves "link name matches" switched on
 *   - same name, different phone          → warning; a NEW customer is
 *     created and nothing is merged
 *   - invoice number already in the account → skipped (safe to re-run)
 *   - invoice number repeated in the file   → later rows rejected
 */
import { addDays, parseFlexibleDate } from "./dates";
import { parseAmountToPaise, type AmountParseError } from "./money";
import { normalizeIndianPhone } from "./phone";

export const IMPORT_FIELDS = [
  "customer",
  "phone",
  "email",
  "invoice_number",
  "invoice_date",
  "due_date",
  "amount",
  "paid_amount",
  "notes",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

const HEADER_ALIASES: Record<ImportField, string[]> = {
  customer: ["customer", "customername", "party", "partyname", "partysname", "name", "client", "clientname", "buyer", "company", "particulars", "ledger", "ledgername"],
  phone: ["phone", "mobile", "phonenumber", "mobilenumber", "mobileno", "phoneno", "contact", "contactnumber", "whatsapp", "whatsappnumber"],
  email: ["email", "emailid", "emailaddress", "mail"],
  invoice_number: ["invoice", "invoiceno", "invoicenumber", "invno", "billno", "billnumber", "refno", "reference", "voucherno", "vouchernumber", "docno"],
  invoice_date: ["invoicedate", "date", "billdate", "issuedate", "voucherdate", "docdate"],
  due_date: ["duedate", "dueon", "due", "paymentdue", "duedt"],
  amount: ["amount", "invoiceamount", "total", "billamount", "pendingamount", "balance", "outstanding", "amountdue", "pending", "balanceamount", "netamount"],
  paid_amount: ["paid", "paidamount", "amountpaid", "received", "receivedamount", "amountreceived"],
  notes: ["notes", "note", "remarks", "remark", "narration", "description"],
};

export function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export type ColumnMap = Partial<Record<ImportField, number>>;

export function detectColumns(header: string[]): ColumnMap {
  const map: ColumnMap = {};
  const normalized = header.map(normalizeHeader);
  for (const field of IMPORT_FIELDS) {
    const idx = normalized.findIndex((h, i) => HEADER_ALIASES[field].includes(h) && !Object.values(map).includes(i));
    if (idx >= 0) map[field] = idx;
  }
  return map;
}

export type RowIssue =
  | { code: "missing_customer" }
  | { code: "missing_invoice_number" }
  | { code: "invoice_number_too_long" }
  | { code: "missing_amount" }
  | { code: "bad_amount"; reason: AmountParseError }
  | { code: "bad_paid_amount"; reason: AmountParseError }
  | { code: "paid_exceeds_amount" }
  | { code: "bad_invoice_date"; value: string }
  | { code: "bad_due_date"; value: string }
  | { code: "missing_dates" }
  | { code: "due_before_invoice" }
  | { code: "bad_phone"; value: string }
  | { code: "duplicate_in_file"; firstRow: number }
  | { code: "already_exists" }
  | { code: "possible_duplicate_name"; existingContactId: string }
  | { code: "same_name_different_phone"; existingContactId: string };

export interface ExistingCustomer {
  id: string;
  name: string | null;
  company: string | null;
  phone_normalized: string | null;
}

export interface PlannedRow {
  /** 1-based spreadsheet row number (header is row 1). */
  rowNumber: number;
  status: "ready" | "skip" | "error";
  errors: RowIssue[];
  warnings: RowIssue[];
  customerName: string;
  phoneE164: string | null;
  email: string | null;
  invoiceNumber: string;
  issueDate: string | null;
  dueDate: string | null;
  amountPaise: number | null;
  paidPaise: number;
  notes: string | null;
  /** Existing contact to attach to, or a key into newCustomers. */
  customerRef: { kind: "existing"; contactId: string } | { kind: "new"; key: string } | null;
}

export interface NewCustomerPlan {
  key: string;
  name: string;
  phoneE164: string | null;
  email: string | null;
}

export interface ImportPlan {
  columns: ColumnMap;
  missingRequiredColumns: ImportField[];
  rows: PlannedRow[];
  newCustomers: NewCustomerPlan[];
  summary: { total: number; ready: number; skipped: number; errors: number; warnings: number; newCustomers: number };
}

export interface PlanOptions {
  existingCustomers: ExistingCustomer[];
  /** Upper-cased invoice numbers already in the account. */
  existingInvoiceNumbers: Set<string>;
  /** Used when a row has an invoice date but no due date. */
  defaultCreditDays: number;
  /** Attach rows whose customer name matches an existing customer (no phone in file). */
  linkNameMatches: boolean;
  maxRows?: number;
}

export const MAX_IMPORT_ROWS = 5000;

const nameKey = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

export function planInvoiceImport(table: string[][], options: PlanOptions): ImportPlan {
  const [header = [], ...body] = table;
  const columns = detectColumns(header);
  const missingRequiredColumns = (["customer", "invoice_number", "amount"] as const).filter((f) => columns[f] === undefined);
  if (columns.invoice_date === undefined && columns.due_date === undefined) missingRequiredColumns.push("due_date");

  const byPhone = new Map<string, ExistingCustomer>();
  const byName = new Map<string, ExistingCustomer[]>();
  for (const c of options.existingCustomers) {
    if (c.phone_normalized) byPhone.set(c.phone_normalized, c);
    for (const n of new Set([nameKey(c.name), nameKey(c.company)])) {
      if (!n) continue;
      byName.set(n, [...(byName.get(n) ?? []), c]);
    }
  }

  const newCustomers = new Map<string, NewCustomerPlan>();
  const seenInvoice = new Map<string, number>();
  const rows: PlannedRow[] = [];
  const cell = (r: string[], f: ImportField) => {
    const i = columns[f];
    return i === undefined ? "" : (r[i] ?? "").trim();
  };

  const limit = Math.min(body.length, options.maxRows ?? MAX_IMPORT_ROWS);
  for (let idx = 0; idx < limit; idx++) {
    const r = body[idx];
    const rowNumber = idx + 2;
    const errors: RowIssue[] = [];
    const warnings: RowIssue[] = [];

    const customerName = cell(r, "customer").replace(/\s+/g, " ");
    const invoiceNumber = cell(r, "invoice_number");
    const rawPhone = cell(r, "phone");
    const email = cell(r, "email") || null;
    const notes = cell(r, "notes") || null;

    if (!customerName) errors.push({ code: "missing_customer" });
    if (!invoiceNumber) errors.push({ code: "missing_invoice_number" });
    else if (invoiceNumber.length > 64) errors.push({ code: "invoice_number_too_long" });

    let amountPaise: number | null = null;
    const rawAmount = cell(r, "amount");
    if (!rawAmount) errors.push({ code: "missing_amount" });
    else {
      const a = parseAmountToPaise(rawAmount);
      if (a.ok) amountPaise = a.paise;
      else errors.push({ code: "bad_amount", reason: a.error });
    }

    let paidPaise = 0;
    const rawPaid = cell(r, "paid_amount");
    if (rawPaid && !/^0+(\.0+)?$/.test(rawPaid.replace(/[₹,\s]|rs\.?/gi, ""))) {
      const p = parseAmountToPaise(rawPaid);
      if (p.ok) paidPaise = p.paise;
      else errors.push({ code: "bad_paid_amount", reason: p.error });
    }
    if (amountPaise !== null && paidPaise > amountPaise) errors.push({ code: "paid_exceeds_amount" });

    const rawIssue = cell(r, "invoice_date");
    const rawDue = cell(r, "due_date");
    let issueDate = rawIssue ? parseFlexibleDate(rawIssue) : null;
    let dueDate = rawDue ? parseFlexibleDate(rawDue) : null;
    if (rawIssue && !issueDate) errors.push({ code: "bad_invoice_date", value: rawIssue });
    if (rawDue && !dueDate) errors.push({ code: "bad_due_date", value: rawDue });
    if (!rawIssue && !rawDue) errors.push({ code: "missing_dates" });
    if (issueDate && !dueDate && !rawDue) dueDate = addDays(issueDate, Math.max(0, options.defaultCreditDays));
    if (dueDate && !issueDate && !rawIssue) issueDate = dueDate;
    if (issueDate && dueDate && dueDate < issueDate) errors.push({ code: "due_before_invoice" });

    let phoneE164: string | null = null;
    let phoneDigits: string | null = null;
    if (rawPhone) {
      const p = normalizeIndianPhone(rawPhone);
      if (p.ok) {
        phoneE164 = p.e164;
        phoneDigits = p.digits;
      } else {
        warnings.push({ code: "bad_phone", value: rawPhone });
      }
    }

    const invKey = invoiceNumber.toUpperCase();
    let status: PlannedRow["status"] = "ready";
    if (invoiceNumber) {
      const first = seenInvoice.get(invKey);
      if (first !== undefined) errors.push({ code: "duplicate_in_file", firstRow: first });
      else seenInvoice.set(invKey, rowNumber);
    }
    if (errors.length > 0) status = "error";
    else if (options.existingInvoiceNumbers.has(invKey)) {
      status = "skip";
      warnings.push({ code: "already_exists" });
    }

    let customerRef: PlannedRow["customerRef"] = null;
    if (status === "ready") {
      const phoneMatch = phoneDigits ? byPhone.get(phoneDigits) : undefined;
      const nameMatches = byName.get(nameKey(customerName)) ?? [];
      if (phoneMatch) {
        customerRef = { kind: "existing", contactId: phoneMatch.id };
      } else if (nameMatches.length > 0 && !phoneDigits && options.linkNameMatches && nameMatches.length === 1) {
        customerRef = { kind: "existing", contactId: nameMatches[0].id };
        warnings.push({ code: "possible_duplicate_name", existingContactId: nameMatches[0].id });
      } else {
        if (nameMatches.length > 0) {
          warnings.push(
            phoneDigits
              ? { code: "same_name_different_phone", existingContactId: nameMatches[0].id }
              : { code: "possible_duplicate_name", existingContactId: nameMatches[0].id },
          );
        }
        const key = phoneDigits ? `p:${phoneDigits}` : `n:${nameKey(customerName)}`;
        if (!newCustomers.has(key)) newCustomers.set(key, { key, name: customerName, phoneE164, email });
        customerRef = { kind: "new", key };
      }
    }

    rows.push({
      rowNumber,
      status,
      errors,
      warnings,
      customerName,
      phoneE164,
      email,
      invoiceNumber,
      issueDate,
      dueDate,
      amountPaise,
      paidPaise,
      notes,
      customerRef,
    });
  }

  const summary = {
    total: rows.length,
    ready: rows.filter((r) => r.status === "ready").length,
    skipped: rows.filter((r) => r.status === "skip").length,
    errors: rows.filter((r) => r.status === "error").length,
    warnings: rows.filter((r) => r.warnings.length > 0).length,
    newCustomers: newCustomers.size,
  };
  return { columns, missingRequiredColumns, rows, newCustomers: [...newCustomers.values()], summary };
}

/** Sample file offered on the import screen. */
export const SAMPLE_IMPORT_CSV = [
  "Customer Name,Phone,Invoice No,Invoice Date,Due Date,Amount,Paid Amount,Notes",
  'Sharma Electricals,9876543210,INV-1001,01/09/2026,01/10/2026,"1,25,000",25000,',
  "Gupta Hardware Stores,+91 98123 45678,INV-1002,15/09/2026,15/10/2026,48500.50,,Cement order",
  "Sharma Electricals,9876543210,INV-1003,05/10/2026,,32000,,",
].join("\n");
