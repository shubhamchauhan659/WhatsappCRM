/**
 * Executes an ImportPlan through a (browser, RLS-scoped) Supabase client.
 *
 * Re-running the same file is safe: invoice numbers are unique per
 * business, so already-imported rows come back as 23505 and are counted
 * as skipped; their opening payments are never inserted twice because
 * payments are only created for invoices inserted in this run.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ImportPlan, PlannedRow } from "./import";

export interface ImportRunResult {
  imported: number;
  skipped: number;
  customersCreated: number;
  paymentsRecorded: number;
  failed: { rowNumber: number; reason: string }[];
}

interface RunOptions {
  plan: ImportPlan;
  accountId: string;
  userId: string;
  currency: string;
  onProgress?: (done: number, total: number) => void;
}

type PgError = { code?: string; message?: string } | null;
const isUnique = (e: PgError) => e?.code === "23505";
const CHUNK = 100;

function chunks<T>(list: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export async function runInvoiceImport(supabase: SupabaseClient, opts: RunOptions): Promise<ImportRunResult> {
  const { plan, accountId, userId, currency, onProgress } = opts;
  const result: ImportRunResult = { imported: 0, skipped: 0, customersCreated: 0, paymentsRecorded: 0, failed: [] };
  const ready = plan.rows.filter((r) => r.status === "ready");
  result.skipped = plan.rows.filter((r) => r.status === "skip").length;
  const total = plan.newCustomers.length + ready.length;
  let done = 0;
  const tick = (n: number) => {
    done += n;
    onProgress?.(done, total);
  };

  // 1. Customers.
  const contactIdByKey = new Map<string, string>();
  const findByPhone = async (e164: string | null) => {
    if (!e164) return null;
    const { data } = await supabase
      .from("contacts")
      .select("id")
      .eq("account_id", accountId)
      .eq("phone_normalized", e164.replace(/\D/g, ""))
      .maybeSingle();
    return (data as { id: string } | null)?.id ?? null;
  };
  for (const batch of chunks(plan.newCustomers, 50)) {
    const rows = batch.map((c) => ({
      user_id: userId,
      account_id: accountId,
      name: c.name,
      phone: c.phoneE164 ?? "",
      email: c.email,
    }));
    const { data, error } = await supabase.from("contacts").insert(rows).select("id");
    if (!error && data && data.length === batch.length) {
      batch.forEach((c, i) => contactIdByKey.set(c.key, (data[i] as { id: string }).id));
      result.customersCreated += batch.length;
    } else {
      for (let i = 0; i < batch.length; i++) {
        const { data: one, error: oneErr } = await supabase.from("contacts").insert(rows[i]).select("id").single();
        if (!oneErr && one) {
          contactIdByKey.set(batch[i].key, (one as { id: string }).id);
          result.customersCreated += 1;
        } else if (isUnique(oneErr)) {
          const existing = await findByPhone(batch[i].phoneE164);
          if (existing) contactIdByKey.set(batch[i].key, existing);
        }
      }
    }
    tick(batch.length);
  }

  // 2. Invoices.
  const contactFor = (r: PlannedRow): string | null =>
    r.customerRef?.kind === "existing" ? r.customerRef.contactId : r.customerRef ? (contactIdByKey.get(r.customerRef.key) ?? null) : null;
  const inserted: { row: PlannedRow; invoiceId: string }[] = [];

  for (const batch of chunks(ready)) {
    const pending: { row: PlannedRow; payload: Record<string, unknown> }[] = [];
    for (const row of batch) {
      const contactId = contactFor(row);
      if (!contactId) {
        result.failed.push({ rowNumber: row.rowNumber, reason: "customer could not be created" });
        continue;
      }
      pending.push({
        row,
        payload: {
          account_id: accountId,
          contact_id: contactId,
          invoice_number: row.invoiceNumber,
          issue_date: row.issueDate,
          due_date: row.dueDate,
          total_paise: row.amountPaise,
          currency,
          notes: row.notes,
          source: "import",
        },
      });
    }
    if (pending.length > 0) {
      const { data, error } = await supabase.from("invoices").insert(pending.map((p) => p.payload)).select("id");
      if (!error && data && data.length === pending.length) {
        pending.forEach((p, i) => inserted.push({ row: p.row, invoiceId: (data[i] as { id: string }).id }));
        result.imported += pending.length;
      } else {
        for (const p of pending) {
          const { data: one, error: oneErr } = await supabase.from("invoices").insert(p.payload).select("id").single();
          if (!oneErr && one) {
            inserted.push({ row: p.row, invoiceId: (one as { id: string }).id });
            result.imported += 1;
          } else if (isUnique(oneErr)) {
            result.skipped += 1;
          } else {
            result.failed.push({ rowNumber: p.row.rowNumber, reason: oneErr?.message ?? "insert failed" });
          }
        }
      }
    }
    tick(batch.length);
  }

  // 3. Amounts already received before the import, as real payment rows.
  const openingPayments = inserted
    .filter(({ row }) => row.paidPaise > 0)
    .map(({ row, invoiceId }) => ({
      row,
      payload: {
        account_id: accountId,
        invoice_id: invoiceId,
        kind: "payment",
        amount_paise: row.paidPaise,
        paid_on: row.issueDate,
        method: "other",
        notes: "Received before import (opening balance)",
      },
    }));
  for (const batch of chunks(openingPayments)) {
    const { error } = await supabase.from("invoice_payments").insert(batch.map((b) => b.payload));
    if (!error) {
      result.paymentsRecorded += batch.length;
      continue;
    }
    for (const b of batch) {
      const { error: oneErr } = await supabase.from("invoice_payments").insert(b.payload);
      if (!oneErr) result.paymentsRecorded += 1;
      else result.failed.push({ rowNumber: b.row.rowNumber, reason: `invoice imported, opening payment failed: ${oneErr.message ?? ""}` });
    }
  }

  return result;
}
