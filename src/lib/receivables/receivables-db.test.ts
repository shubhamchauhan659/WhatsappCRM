/**
 * Database-level guarantees of migration 060 (receivables), exercised
 * against real Postgres (PGlite) with every migration replayed.
 *
 * These are the invariants the UI relies on but must not be the only
 * line of defence for: tenant isolation, derived payment totals,
 * over-payment prevention, immutable payments, idempotent retries,
 * the audit trail, and account deletion.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./pglite.test-helper";

let t: TestDb;
let alice: { userId: string; accountId: string };
let bob: { userId: string; accountId: string };
let aliceContact: string;
let bobContact: string;
let bobInvoice: string;

async function pgError(promise: Promise<unknown>): Promise<{ code?: string; message: string }> {
  try {
    await promise;
  } catch (err) {
    const e = err as { code?: string; message: string };
    return { code: e.code, message: e.message };
  }
  throw new Error("expected the statement to fail, but it succeeded");
}

async function insertContact(as: { userId: string; accountId: string }, name: string, phone = "") {
  return t.asUser(as.userId, async () => {
    const { rows } = await t.db.query<{ id: string }>(
      `INSERT INTO contacts (user_id, account_id, name, phone) VALUES ($1, $2, $3, $4) RETURNING id`,
      [as.userId, as.accountId, name, phone],
    );
    return rows[0].id;
  });
}

async function insertInvoice(
  as: { userId: string; accountId: string },
  contactId: string,
  number: string,
  totalPaise: number,
  dueDate = "2026-01-31",
) {
  return t.asUser(as.userId, async () => {
    const { rows } = await t.db.query<{ id: string }>(
      `INSERT INTO invoices (account_id, contact_id, invoice_number, issue_date, due_date, total_paise)
       VALUES ($1, $2, $3, '2026-01-01', $4, $5) RETURNING id`,
      [as.accountId, contactId, number, dueDate, totalPaise],
    );
    return rows[0].id;
  });
}

async function pay(
  as: { userId: string; accountId: string },
  invoiceId: string,
  amountPaise: number,
  kind: "payment" | "credit_note" = "payment",
  clientRef: string | null = null,
) {
  return t.asUser(as.userId, async () => {
    const { rows } = await t.db.query<{ id: string }>(
      `INSERT INTO invoice_payments (account_id, invoice_id, kind, amount_paise, paid_on, method, client_ref)
       VALUES ($1, $2, $3, $4, '2026-02-01', 'upi', $5) RETURNING id`,
      [as.accountId, invoiceId, kind, amountPaise, clientRef],
    );
    return rows[0].id;
  });
}

async function invoiceTotals(invoiceId: string) {
  const { rows } = await t.db.query<{
    paid_paise: string;
    credited_paise: string;
    outstanding_paise: string;
    status: string;
  }>(`SELECT paid_paise, credited_paise, outstanding_paise, status FROM invoices WHERE id = $1`, [invoiceId]);
  const r = rows[0];
  return {
    paid: Number(r.paid_paise),
    credited: Number(r.credited_paise),
    outstanding: Number(r.outstanding_paise),
    status: r.status,
  };
}

beforeAll(async () => {
  t = await createTestDb();
  alice = await t.createUser("alice@example.com");
  bob = await t.createUser("bob@example.com");
  aliceContact = await insertContact(alice, "Sharma Traders", "+919876543210");
  bobContact = await insertContact(bob, "Gupta Hardware", "+919812345678");
  bobInvoice = await insertInvoice(bob, bobContact, "B-001", 50_000_00);
}, 120_000);

afterAll(async () => {
  await t?.close();
});

describe("migration chain", () => {
  it("passes the CI schema verification script", async () => {
    const verify = readFileSync(join(process.cwd(), "supabase", "ci", "verify-schema.sql"), "utf8");
    await expect(t.db.exec(verify)).resolves.toBeDefined();
  });

  it("defaults new businesses to INR and Asia/Kolkata", async () => {
    const { rows } = await t.db.query<{ default_currency: string; timezone: string }>(
      `SELECT default_currency, timezone FROM accounts WHERE id = $1`,
      [alice.accountId],
    );
    expect(rows[0]).toEqual({ default_currency: "INR", timezone: "Asia/Kolkata" });
  });

  it("rejects an invalid business timezone", async () => {
    const err = await pgError(
      t.db.query(`UPDATE accounts SET timezone = 'Mars/Olympus' WHERE id = $1`, [alice.accountId]),
    );
    expect(err.message).toMatch(/accounts_timezone_valid/);
  });
});

describe("business isolation", () => {
  it("one business cannot read another business's customers or invoices", async () => {
    const seen = await t.asUser(alice.userId, async () => {
      const contacts = await t.db.query(`SELECT id FROM contacts WHERE id = $1`, [bobContact]);
      const invoices = await t.db.query(`SELECT id FROM invoices WHERE account_id = $1`, [bob.accountId]);
      const all = await t.db.query<{ account_id: string }>(`SELECT account_id FROM invoices`);
      return { contacts: contacts.rows.length, invoices: invoices.rows.length, all: all.rows };
    });
    expect(seen.contacts).toBe(0);
    expect(seen.invoices).toBe(0);
    expect(seen.all.every((r) => r.account_id === alice.accountId)).toBe(true);
  });

  it("cannot create an invoice inside another business", async () => {
    const err = await pgError(insertInvoice({ userId: alice.userId, accountId: bob.accountId }, bobContact, "X-1", 100));
    expect(err.message).toMatch(/row-level security/);
  });

  it("cannot attach its invoice to another business's customer, even by UUID", async () => {
    const err = await pgError(insertInvoice(alice, bobContact, "A-STEAL", 100));
    expect(err.message).toMatch(/invoices_contact_fk/);
  });

  it("cannot record a payment against another business's invoice", async () => {
    const err = await pgError(pay(alice, bobInvoice, 100));
    expect(err.message).toMatch(/invoice_payments_invoice_fk/);
    expect((await invoiceTotals(bobInvoice)).paid).toBe(0);
  });

  it("cannot log a follow-up on another business's customer", async () => {
    const err = await pgError(
      t.asUser(alice.userId, () =>
        t.db.query(`INSERT INTO follow_ups (account_id, contact_id, status) VALUES ($1, $2, 'reminder_sent')`, [
          alice.accountId,
          bobContact,
        ]),
      ),
    );
    expect(err.message).toMatch(/follow_ups_contact_fk/);
  });

  it("cannot update or delete another business's invoice (silently matches zero rows)", async () => {
    const result = await t.asUser(alice.userId, async () => {
      const upd = await t.db.query(`UPDATE invoices SET notes = 'pwned' WHERE id = $1`, [bobInvoice]);
      const del = await t.db.query(`DELETE FROM invoices WHERE id = $1`, [bobInvoice]);
      return { upd: upd.affectedRows, del: del.affectedRows };
    });
    expect(result).toEqual({ upd: 0, del: 0 });
  });

  it("the anon key has no access to receivables tables at all", async () => {
    const err = await pgError(t.asAnon(() => t.db.query(`SELECT 1 FROM invoices LIMIT 1`)));
    expect(err.message).toMatch(/permission denied/);
  });

  it("read-only (viewer) members can read but not write", async () => {
    const viewer = await t.createUser("viewer@example.com");
    await t.db.query(`UPDATE profiles SET account_id = $1, account_role = 'viewer' WHERE user_id = $2`, [
      alice.accountId,
      viewer.userId,
    ]);
    await t.db.query(`DELETE FROM accounts WHERE id = $1`, [viewer.accountId]);
    const member = { userId: viewer.userId, accountId: alice.accountId };

    const readable = await t.asUser(viewer.userId, () =>
      t.db.query(`SELECT id FROM contacts WHERE id = $1`, [aliceContact]),
    );
    expect(readable.rows).toHaveLength(1);
    const err = await pgError(insertInvoice(member, aliceContact, "V-1", 100));
    expect(err.message).toMatch(/row-level security/);
  });
});

describe("payments and derived balances", () => {
  it("a new invoice starts fully outstanding even if the client lies about paid_paise", async () => {
    const id = await t.asUser(alice.userId, async () => {
      const { rows } = await t.db.query<{ id: string }>(
        `INSERT INTO invoices (account_id, contact_id, invoice_number, issue_date, due_date, total_paise, paid_paise)
         VALUES ($1, $2, 'A-LIE', '2026-01-01', '2026-01-15', 10000, 10000) RETURNING id`,
        [alice.accountId, aliceContact],
      );
      return rows[0].id;
    });
    expect(await invoiceTotals(id)).toMatchObject({ paid: 0, outstanding: 10000 });
  });

  it("partial payments and credit notes produce the correct outstanding balance", async () => {
    const id = await insertInvoice(alice, aliceContact, "A-100", 1_00_000_00); // ₹1,00,000
    await pay(alice, id, 25_000_00);
    await pay(alice, id, 10_000_50);
    await pay(alice, id, 5_000_00, "credit_note");
    expect(await invoiceTotals(id)).toEqual({
      paid: 35_000_50,
      credited: 5_000_00,
      outstanding: 59_999_50,
      status: "open",
    });
  });

  it("over-payment is rejected and leaves totals untouched", async () => {
    const id = await insertInvoice(alice, aliceContact, "A-OVER", 1000);
    await pay(alice, id, 600);
    const err = await pgError(pay(alice, id, 401));
    expect(err.message).toMatch(/invoices_not_overpaid/);
    expect(await invoiceTotals(id)).toMatchObject({ paid: 600, outstanding: 400 });
  });

  it("a fully paid invoice has zero outstanding", async () => {
    const id = await insertInvoice(alice, aliceContact, "A-FULL", 1000);
    await pay(alice, id, 1000);
    expect(await invoiceTotals(id)).toMatchObject({ paid: 1000, outstanding: 0 });
  });

  it("clients cannot edit derived totals directly", async () => {
    const id = await insertInvoice(alice, aliceContact, "A-EDIT", 1000);
    const err = await pgError(
      t.asUser(alice.userId, () => t.db.query(`UPDATE invoices SET paid_paise = 1000 WHERE id = $1`, [id])),
    );
    expect(err.message).toMatch(/derived from payments/);
    expect((await invoiceTotals(id)).outstanding).toBe(1000);
  });

  it("an invoice total cannot be reduced below what was already received", async () => {
    const id = await insertInvoice(alice, aliceContact, "A-SHRINK", 1000);
    await pay(alice, id, 800);
    const err = await pgError(
      t.asUser(alice.userId, () => t.db.query(`UPDATE invoices SET total_paise = 500 WHERE id = $1`, [id])),
    );
    expect(err.message).toMatch(/invoices_not_overpaid/);
  });

  it("payments are immutable; voiding is one-way and restores the balance", async () => {
    const id = await insertInvoice(alice, aliceContact, "A-VOID", 1000);
    const paymentId = await pay(alice, id, 700);

    const editErr = await pgError(
      t.asUser(alice.userId, () =>
        t.db.query(`UPDATE invoice_payments SET amount_paise = 1 WHERE id = $1`, [paymentId]),
      ),
    );
    expect(editErr.message).toMatch(/immutable/);

    await t.asUser(alice.userId, () =>
      t.db.query(`UPDATE invoice_payments SET voided_at = NOW(), void_reason = 'entered twice' WHERE id = $1`, [
        paymentId,
      ]),
    );
    expect(await invoiceTotals(id)).toMatchObject({ paid: 0, outstanding: 1000 });

    const again = await pgError(
      t.asUser(alice.userId, () =>
        t.db.query(`UPDATE invoice_payments SET voided_at = NOW(), void_reason = 'again' WHERE id = $1`, [paymentId]),
      ),
    );
    expect(again.message).toMatch(/immutable|already void/);
    expect((await invoiceTotals(id)).paid).toBe(0);
  });

  it("payments cannot be deleted by end users", async () => {
    const id = await insertInvoice(alice, aliceContact, "A-DEL", 1000);
    const paymentId = await pay(alice, id, 100);
    const del = await t.asUser(alice.userId, () =>
      t.db.query(`DELETE FROM invoice_payments WHERE id = $1`, [paymentId]),
    );
    expect(del.affectedRows).toBe(0);
    expect((await invoiceTotals(id)).paid).toBe(100);
  });

  it("a retried payment with the same client_ref is recorded once", async () => {
    const id = await insertInvoice(alice, aliceContact, "A-RETRY", 1000);
    const ref = "8b8f3a52-4b7e-4f43-9a3e-0f6c1f6f0a01";
    await pay(alice, id, 300, "payment", ref);
    const err = await pgError(pay(alice, id, 300, "payment", ref));
    expect(err.code).toBe("23505");
    expect((await invoiceTotals(id)).paid).toBe(300);
  });

  it("cancelled invoices drop out of outstanding and cannot take payments", async () => {
    const id = await insertInvoice(alice, aliceContact, "A-CANCEL", 1000);
    await t.asUser(alice.userId, () =>
      t.db.query(`UPDATE invoices SET status = 'cancelled', cancel_reason = 'duplicate bill' WHERE id = $1`, [id]),
    );
    expect(await invoiceTotals(id)).toMatchObject({ status: "cancelled", outstanding: 0 });
    const err = await pgError(pay(alice, id, 100));
    expect(err.message).toMatch(/invoices_cancel_requires_no_settlement/);
  });

  it("an invoice with payments cannot be cancelled", async () => {
    const id = await insertInvoice(alice, aliceContact, "A-PAIDCANCEL", 1000);
    await pay(alice, id, 100);
    const err = await pgError(
      t.asUser(alice.userId, () => t.db.query(`UPDATE invoices SET status = 'cancelled' WHERE id = $1`, [id])),
    );
    expect(err.message).toMatch(/invoices_cancel_requires_no_settlement/);
  });

  it("invoice numbers are unique per business, case-insensitively, but not across businesses", async () => {
    await insertInvoice(alice, aliceContact, "INV-77", 100);
    const dup = await pgError(insertInvoice(alice, aliceContact, "inv-77", 100));
    expect(dup.code).toBe("23505");
    await expect(insertInvoice(bob, bobContact, "INV-77", 100)).resolves.toBeTruthy();
  });

  it("a customer with invoices cannot be deleted out from under them", async () => {
    const contact = await insertContact(alice, "Has Invoices");
    await insertInvoice(alice, contact, "A-KEEP", 100);
    const err = await pgError(
      t.asUser(alice.userId, () => t.db.query(`DELETE FROM contacts WHERE id = $1`, [contact])),
    );
    expect(err.code).toBe("23503");
  });
});

describe("follow-ups and promises", () => {
  it("records a promise to pay with date and amount", async () => {
    const id = await insertInvoice(alice, aliceContact, "A-PROMISE", 20_000_00);
    const row = await t.asUser(alice.userId, async () => {
      const { rows } = await t.db.query<{ promise_date: string; promised_paise: string | number; recorded_by: string }>(
        `INSERT INTO follow_ups (account_id, contact_id, invoice_id, channel, status, promise_date, promised_paise, summary)
         VALUES ($1, $2, $3, 'call', 'promise_to_pay', '2026-02-10', 1500000, 'Will pay after Monday')
         RETURNING promise_date::text, promised_paise, recorded_by`,
        [alice.accountId, aliceContact, id],
      );
      return rows[0];
    });
    expect({ ...row, promised_paise: Number(row.promised_paise) }).toEqual({
      promise_date: "2026-02-10",
      promised_paise: 15_000_00,
      recorded_by: alice.userId,
    });
  });

  it("a promise without a date or amount is rejected", async () => {
    const err = await pgError(
      t.asUser(alice.userId, () =>
        t.db.query(
          `INSERT INTO follow_ups (account_id, contact_id, status, promise_date) VALUES ($1, $2, 'promise_to_pay', '2026-02-10')`,
          [alice.accountId, aliceContact],
        ),
      ),
    );
    expect(err.message).toMatch(/follow_ups_promise_complete/);
  });

  it("a promise never changes what the invoice owes", async () => {
    const id = await insertInvoice(alice, aliceContact, "A-PROMISE-ONLY", 5000);
    await t.asUser(alice.userId, () =>
      t.db.query(
        `INSERT INTO follow_ups (account_id, contact_id, invoice_id, status, promise_date, promised_paise)
         VALUES ($1, $2, $3, 'paid', '2026-02-10', 5000)`,
        [alice.accountId, aliceContact, id],
      ),
    );
    expect(await invoiceTotals(id)).toMatchObject({ paid: 0, outstanding: 5000 });
  });

  it("a retried 'reminder sent' confirmation with the same client_ref is stored once", async () => {
    const ref = "1f0e4c55-2a3b-4c5d-8e9f-a0b1c2d3e4f5";
    const insert = () =>
      t.asUser(alice.userId, () =>
        t.db.query(
          `INSERT INTO follow_ups (account_id, contact_id, status, channel, message, client_ref)
           VALUES ($1, $2, 'reminder_sent', 'whatsapp', 'Namaste…', $3)
           ON CONFLICT (account_id, client_ref) WHERE client_ref IS NOT NULL DO NOTHING`,
          [alice.accountId, aliceContact, ref],
        ),
      );
    await insert();
    await insert();
    const { rows } = await t.db.query(`SELECT 1 FROM follow_ups WHERE client_ref = $1`, [ref]);
    expect(rows).toHaveLength(1);
  });
});

describe("audit trail", () => {
  it("records payment inserts and voids with the acting user", async () => {
    const id = await insertInvoice(alice, aliceContact, "A-AUDIT", 1000);
    const paymentId = await pay(alice, id, 400);
    await t.asUser(alice.userId, () =>
      t.db.query(`UPDATE invoice_payments SET voided_at = NOW(), void_reason = 'bounced cheque' WHERE id = $1`, [
        paymentId,
      ]),
    );
    const { rows } = await t.db.query<{ action: string; actor_user_id: string }>(
      `SELECT action, actor_user_id FROM audit_events WHERE entity_id = $1 ORDER BY id`,
      [paymentId],
    );
    expect(rows.map((r) => r.action)).toEqual(["insert", "void"]);
    expect(rows.every((r) => r.actor_user_id === alice.userId)).toBe(true);
  });

  it("is append-only for end users and isolated per business", async () => {
    const err = await pgError(
      t.asUser(alice.userId, () =>
        t.db.query(
          `INSERT INTO audit_events (account_id, entity_type, entity_id, action) VALUES ($1, 'invoices', gen_random_uuid(), 'insert')`,
          [alice.accountId],
        ),
      ),
    );
    expect(err.message).toMatch(/permission denied/);
    const foreign = await t.asUser(alice.userId, () =>
      t.db.query(`SELECT 1 FROM audit_events WHERE account_id = $1`, [bob.accountId]),
    );
    expect(foreign.rows).toHaveLength(0);
  });
});

describe("account lifecycle", () => {
  it("joining another business is refused while the personal account holds invoices", async () => {
    const carol = await t.createUser("carol@example.com");
    const contact = await insertContact(carol, "Carol's customer");
    await insertInvoice(carol, contact, "C-1", 100);
    // Remove the contact-level guard so only the receivables guard can trip:
    // the contact is referenced by the invoice, so delete via superuser cascade
    // is impossible — instead verify the error comes from the data check.
    await t.db.query(
      `INSERT INTO account_invitations (account_id, token_hash, role, expires_at)
       VALUES ($1, 'hash-carol', 'agent', NOW() + interval '1 day')`,
      [alice.accountId],
    );
    const err = await pgError(
      t.asUser(carol.userId, () => t.db.query(`SELECT redeem_invitation('hash-carol')`)),
    );
    expect(err.message).toMatch(/already contains data/);
    const { rows } = await t.db.query(`SELECT 1 FROM invoices WHERE account_id = $1`, [carol.accountId]);
    expect(rows).toHaveLength(1);
  });

  it("deleting a business removes all of its receivables data and nothing else", async () => {
    const dave = await t.createUser("dave@example.com");
    const contact = await insertContact(dave, "Dave's customer");
    const invoice = await insertInvoice(dave, contact, "D-1", 1000);
    await pay(dave, invoice, 500);
    await t.asUser(dave.userId, () =>
      t.db.query(`INSERT INTO follow_ups (account_id, contact_id, invoice_id, status) VALUES ($1, $2, $3, 'reminder_sent')`, [
        dave.accountId,
        contact,
        invoice,
      ]),
    );
    const bobBefore = await invoiceTotals(bobInvoice);

    await t.db.query(`DELETE FROM accounts WHERE id = $1`, [dave.accountId]);

    for (const table of ["contacts", "invoices", "invoice_payments", "follow_ups", "audit_events"]) {
      const { rows } = await t.db.query(`SELECT 1 FROM ${table} WHERE account_id = $1`, [dave.accountId]);
      expect(rows, table).toHaveLength(0);
    }
    expect(await invoiceTotals(bobInvoice)).toEqual(bobBefore);

    // Second step of DELETE /api/account: the login itself can then go
    // (auth.admin.deleteUser) without any foreign key blocking it.
    await t.db.query(`DELETE FROM auth.users WHERE id = $1`, [dave.userId]);
    const { rows: left } = await t.db.query(`SELECT 1 FROM profiles WHERE user_id = $1`, [dave.userId]);
    expect(left).toHaveLength(0);
  });

  it("the login cannot be deleted while it still owns an account (deletion order is enforced)", async () => {
    const erin = await t.createUser("erin@example.com");
    const err = await pgError(t.db.query(`DELETE FROM auth.users WHERE id = $1`, [erin.userId]));
    expect(err.code).toBe("23001"); // restrict_violation: accounts.owner_user_id ON DELETE RESTRICT
  });

  it("backup and restore: a plain SQL dump of a business's rows restores identical balances", async () => {
    const frank = await t.createUser("frank@example.com");
    const contact = await insertContact(frank, "Frank's customer", "+919811122233");
    const invoice = await insertInvoice(frank, contact, "F-1", 10_000_00);
    await pay(frank, invoice, 2_500_00);
    const before = await invoiceTotals(invoice);

    // Dump: the data a pg_dump of these tables would contain.
    const snapshot = {
      invoice: (await t.db.query(`SELECT * FROM invoices WHERE id = $1`, [invoice])).rows[0] as Record<string, unknown>,
      payments: (await t.db.query(`SELECT * FROM invoice_payments WHERE invoice_id = $1`, [invoice])).rows as Record<string, unknown>[],
    };

    // Disaster: rows lost.
    await t.db.exec(`SET session_replication_role = replica`);
    await t.db.query(`DELETE FROM invoice_payments WHERE invoice_id = $1`, [invoice]);
    await t.db.query(`DELETE FROM invoices WHERE id = $1`, [invoice]);

    // Restore as pg_restore does (triggers disabled → stored totals are taken verbatim).
    const insertRow = async (table: string, row: Record<string, unknown>) => {
      const cols = Object.keys(row).filter((c) => !(table === "invoices" && c === "outstanding_paise"));
      await t.db.query(
        `INSERT INTO ${table} (${cols.join(", ")}) OVERRIDING SYSTEM VALUE VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
        cols.map((c) => row[c]),
      );
    };
    await insertRow("invoices", snapshot.invoice);
    for (const p of snapshot.payments) await insertRow("invoice_payments", p);
    await t.db.exec(`SET session_replication_role = origin`);

    expect(await invoiceTotals(invoice)).toEqual(before);
    // And the restored ledger is internally consistent.
    const { rows } = await t.db.query<{ sum: string }>(
      `SELECT COALESCE(SUM(amount_paise), 0)::text AS sum FROM invoice_payments WHERE invoice_id = $1 AND voided_at IS NULL AND kind = 'payment'`,
      [invoice],
    );
    expect(Number(rows[0].sum)).toBe(before.paid);
  });
});
