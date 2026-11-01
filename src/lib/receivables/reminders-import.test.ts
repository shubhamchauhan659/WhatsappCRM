import { describe, expect, it } from "vitest";
import { makeInvoice } from "./fixtures.test-helper";
import { SAMPLE_IMPORT_CSV, detectColumns, planInvoiceImport } from "./import";
import { parseCsv } from "./csv";
import {
  REMINDER_LANGUAGES,
  REMINDER_TONES,
  allTemplateBodies,
  buildReminderVariables,
  findUnexpectedAmounts,
  getReminderTemplate,
  renderReminder,
} from "./reminders";

const business = { name: "Agarwal Distributors", business_upi_id: "agarwal@okaxis", business_phone: null };
const customer = { name: "Ramesh Sharma", company: "Sharma Electricals", phone: "+919876543210" };
const TODAY = "2026-10-31";

describe("reminder templates", () => {
  it("exist for every language × tone × scope and only use known variables", () => {
    for (const lang of REMINDER_LANGUAGES) {
      for (const tone of REMINDER_TONES) {
        for (const scope of ["single", "multiple"] as const) {
          const r = renderReminder(getReminderTemplate(lang, tone, scope, { includeUpi: true }), {});
          expect(r.unknown, `${lang}/${tone}/${scope}`).toEqual([]);
        }
      }
    }
  });

  it("never threaten, shame or invoke legal action — even the firm tone", () => {
    const banned = /legal|court|police|lawyer|consequence|blacklist|defaulter|threat|penalty|shame|कानूनी|पुलिस|अदालत|वकील|kanooni|vakeel/i;
    for (const body of allTemplateBodies()) expect(body).not.toMatch(banned);
  });

  it("always offer the 'already paid? ignore' courtesy", () => {
    for (const lang of REMINDER_LANGUAGES) {
      for (const tone of REMINDER_TONES) {
        const t = getReminderTemplate(lang, tone, "single");
        expect(t).toMatch(/ignore|अनदेखा|transaction reference|ट्रांज़ैक्शन/i);
      }
    }
  });
});

describe("reminder variables", () => {
  it("substitute the invoice's real outstanding balance, not its total", () => {
    const inv = makeInvoice({ invoice_number: "INV-7", total_paise: 1_25_000_00, paid_paise: 25_000_00, due_date: "2026-10-01" });
    const built = buildReminderVariables({ business, customer, invoices: [inv], today: TODAY, language: "hinglish" });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const r = renderReminder(getReminderTemplate("hinglish", "polite", built.scope), built.variables);
    expect(r.text).toBe(
      "Namaste Ramesh Sharma, invoice INV-7 ke ₹1,00,000 payment ki due date 1 Oct 2026 thi. Kripya payment status confirm kar dein. Agar payment already ho chuki hai, please ignore this reminder. Dhanyavaad.\n\nAgarwal Distributors",
    );
    expect(r.missing).toEqual([]);
    expect(findUnexpectedAmounts(r.text, built.amountsPaise)).toEqual([]);
  });

  it("refuse to build a reminder for a paid or cancelled invoice", () => {
    const paid = makeInvoice({ total_paise: 100, paid_paise: 100 });
    const cancelled = makeInvoice({ status: "cancelled" });
    for (const inv of [paid, cancelled]) {
      expect(buildReminderVariables({ business, customer, invoices: [inv], today: TODAY, language: "en" })).toEqual({
        ok: false,
        error: "nothing_outstanding",
      });
    }
  });

  it("refuse to mix currencies in one statement", () => {
    const invoices = [makeInvoice({}), makeInvoice({ currency: "USD" })];
    expect(buildReminderVariables({ business, customer, invoices, today: TODAY, language: "en" })).toEqual({
      ok: false,
      error: "mixed_currency",
    });
  });

  it("never silently blank a missing value: it stays visible and is reported", () => {
    const inv = makeInvoice({ due_date: "2026-11-30" }); // not overdue → no days_overdue
    const built = buildReminderVariables({ business, customer, invoices: [inv], today: TODAY, language: "en" });
    if (!built.ok) throw new Error("expected ok");
    const r = renderReminder(getReminderTemplate("en", "firm", "single"), built.variables);
    expect(r.missing).toEqual(["days_overdue"]);
    expect(r.text).toContain("{{days_overdue}}");
  });

  it("report unknown placeholders typed by the user", () => {
    const r = renderReminder("Hi {{customer_name}}, pay {{amount_due}}", { customer_name: "A" });
    expect(r.unknown).toEqual(["amount_due"]);
    expect(r.text).toBe("Hi A, pay {{amount_due}}");
  });

  it("flag a hand-typed amount that does not match any real balance", () => {
    expect(findUnexpectedAmounts("Please pay ₹50,000 today", [5_000_00])).toEqual(["₹50,000"]);
    expect(findUnexpectedAmounts("Please pay Rs. 5,000 today", [5_000_00])).toEqual([]);
  });

  it("list several invoices oldest first with the correct total", () => {
    const invoices = [
      makeInvoice({ invoice_number: "B", total_paise: 2_000_00, due_date: "2026-10-10" }),
      makeInvoice({ invoice_number: "A", total_paise: 1_000_50, due_date: "2026-09-10" }),
    ];
    const built = buildReminderVariables({ business, customer, invoices, today: TODAY, language: "hi" });
    if (!built.ok) throw new Error("expected ok");
    expect(built.scope).toBe("multiple");
    expect(built.variables.total_outstanding).toBe("₹3,000.50");
    expect(built.variables.invoice_list).toBe("• A — ₹1,000.50 (देय 10 Sept 2026)\n• B — ₹2,000 (देय 10 Oct 2026)");
  });
});

describe("invoice CSV import", () => {
  const existing = [
    { id: "c-sharma", name: "Sharma Electricals", company: null, phone_normalized: "919876543210" },
    { id: "c-mehta", name: "Mehta Paints", company: null, phone_normalized: "919900000001" },
  ];
  const opts = { existingCustomers: existing, existingInvoiceNumbers: new Set(["INV-OLD"]), defaultCreditDays: 30, linkNameMatches: true };

  it("maps Tally/Excel-style headers", () => {
    expect(detectColumns(["Party Name", "Mobile No", "Bill No", "Bill Date", "Due On", "Pending Amount"])).toEqual({
      customer: 0,
      phone: 1,
      invoice_number: 2,
      invoice_date: 3,
      due_date: 4,
      amount: 5,
    });
  });

  it("plans the sample file: links by phone, groups new customers, defaults due dates", () => {
    const plan = planInvoiceImport(parseCsv(SAMPLE_IMPORT_CSV), opts);
    expect(plan.missingRequiredColumns).toEqual([]);
    expect(plan.summary).toMatchObject({ total: 3, ready: 3, errors: 0, newCustomers: 1 });
    expect(plan.rows[0]).toMatchObject({
      customerRef: { kind: "existing", contactId: "c-sharma" },
      amountPaise: 1_25_000_00,
      paidPaise: 25_000_00,
      issueDate: "2026-09-01",
      dueDate: "2026-10-01",
    });
    expect(plan.rows[1]).toMatchObject({ amountPaise: 48_500_50, customerRef: { kind: "new" } });
    expect(plan.rows[2].dueDate).toBe("2026-11-04"); // 5 Oct + 30 days credit
  });

  it("reports malformed rows with row numbers and reasons", () => {
    const csv = [
      "Customer,Invoice No,Invoice Date,Due Date,Amount,Paid",
      ",X-1,01/10/2026,,100,",
      "A,,01/10/2026,,100,",
      "B,X-3,31/02/2026,,100,",
      "C,X-4,01/10/2026,,-5,",
      "D,X-5,10/10/2026,01/10/2026,100,",
      "E,X-6,01/10/2026,,100,200",
      "F,X-7,,,100,",
    ].join("\n");
    const plan = planInvoiceImport(parseCsv(csv), opts);
    const codes = plan.rows.map((r) => [r.rowNumber, r.errors.map((e) => e.code)]);
    expect(codes).toEqual([
      [2, ["missing_customer"]],
      [3, ["missing_invoice_number"]],
      [4, ["bad_invoice_date"]],
      [5, ["bad_amount"]],
      [6, ["due_before_invoice"]],
      [7, ["paid_exceeds_amount"]],
      [8, ["missing_dates"]],
    ]);
    expect(plan.summary.ready).toBe(0);
  });

  it("flags duplicates instead of merging them", () => {
    const csv = [
      "Customer,Phone,Invoice No,Due Date,Amount",
      "Mehta Paints,,M-1,01/10/2026,100", // name match, no phone → linked + warned
      "Mehta Paints,9811111111,M-2,01/10/2026,100", // name match, different phone → new customer + warned
      "Someone,,INV-OLD,01/10/2026,100", // already in account → skipped
      "Someone,,m-1,01/10/2026,100", // duplicate in file (case-insensitive) → error
    ].join("\n");
    const plan = planInvoiceImport(parseCsv(csv), opts);
    expect(plan.rows[0]).toMatchObject({ status: "ready", customerRef: { kind: "existing", contactId: "c-mehta" } });
    expect(plan.rows[0].warnings.map((w) => w.code)).toEqual(["possible_duplicate_name"]);
    expect(plan.rows[1]).toMatchObject({ status: "ready", customerRef: { kind: "new" } });
    expect(plan.rows[1].warnings.map((w) => w.code)).toEqual(["same_name_different_phone"]);
    expect(plan.rows[2]).toMatchObject({ status: "skip" });
    expect(plan.rows[3].errors).toEqual([{ code: "duplicate_in_file", firstRow: 2 }]);
  });

  it("does not link by name when the user switches that off", () => {
    const csv = "Customer,Invoice No,Due Date,Amount\nMehta Paints,M-9,01/10/2026,100";
    const plan = planInvoiceImport(parseCsv(csv), { ...opts, linkNameMatches: false });
    expect(plan.rows[0].customerRef).toMatchObject({ kind: "new" });
    expect(plan.rows[0].warnings.map((w) => w.code)).toEqual(["possible_duplicate_name"]);
  });

  it("reports missing required columns", () => {
    const plan = planInvoiceImport(parseCsv("Name,Phone\nA,1"), opts);
    expect(plan.missingRequiredColumns).toEqual(["invoice_number", "amount", "due_date"]);
  });
});
