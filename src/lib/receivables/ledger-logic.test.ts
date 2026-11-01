import { describe, expect, it } from "vitest";
import { makeCustomer, makeFollowUp, makeInvoice, makePayment } from "./fixtures.test-helper";
import { buildOverview, customerBalances } from "./overview";
import { evaluatePromises } from "./promises";
import { buildFollowUpQueue } from "./queue";
import { agingBucket, daysOverdue, isOverdue, paymentState } from "./status";

const TODAY = "2026-10-31";
const TZ = "Asia/Kolkata";

describe("invoice status", () => {
  it("a paid invoice is not overdue", () => {
    const inv = makeInvoice({ total_paise: 5000, paid_paise: 5000, due_date: "2026-09-01" });
    expect(paymentState(inv)).toBe("paid");
    expect(isOverdue(inv, TODAY)).toBe(false);
    expect(daysOverdue(inv, TODAY)).toBe(0);
  });

  it("partial payments leave the remainder outstanding and overdue", () => {
    const inv = makeInvoice({ total_paise: 10_000_00, paid_paise: 3_500_50, credited_paise: 500_00, due_date: "2026-10-21" });
    expect(inv.outstanding_paise).toBe(5_999_50);
    expect(paymentState(inv)).toBe("partially_paid");
    expect(daysOverdue(inv, TODAY)).toBe(10);
  });

  it("cancelled invoices are never overdue", () => {
    const inv = makeInvoice({ status: "cancelled", due_date: "2026-01-01" });
    expect(paymentState(inv)).toBe("cancelled");
    expect(isOverdue(inv, TODAY)).toBe(false);
  });

  it("buckets ageing at 7 and 30 days", () => {
    expect([0, 1, 7, 8, 30, 31].map(agingBucket)).toEqual(["current", "d1_7", "d1_7", "d8_30", "d8_30", "d31_plus"]);
  });
});

describe("overview", () => {
  const invoices = [
    makeInvoice({ contact_id: "c-1", total_paise: 100_00, due_date: "2026-10-28" }), // 3 days
    makeInvoice({ contact_id: "c-1", total_paise: 200_00, due_date: "2026-10-11" }), // 20 days
    makeInvoice({ contact_id: "c-2", total_paise: 400_00, paid_paise: 100_00, due_date: "2026-08-01" }), // 91 days, 300 left
    makeInvoice({ contact_id: "c-2", total_paise: 800_00, due_date: "2026-11-30" }), // not due
    makeInvoice({ contact_id: "c-3", total_paise: 999_00, paid_paise: 999_00, due_date: "2026-08-01" }), // paid
    makeInvoice({ contact_id: "c-3", status: "cancelled", total_paise: 50_00, due_date: "2026-08-01" }),
    makeInvoice({ contact_id: "c-4", currency: "USD", total_paise: 70_00, due_date: "2026-08-01" }),
  ];

  it("sums only stored balances, by ageing bucket, in the account currency", () => {
    const o = buildOverview({ invoices, payments: [], followUps: [], today: TODAY, timeZone: TZ, currency: "INR" });
    expect(o.outstandingPaise).toBe(100_00 + 200_00 + 300_00 + 800_00);
    expect(o.overduePaise).toBe(100_00 + 200_00 + 300_00);
    expect(o.aging).toEqual({ current: 800_00, d1_7: 100_00, d8_30: 200_00, d31_plus: 300_00 });
    expect(o.overdueInvoiceCount).toBe(3);
    expect(o.otherCurrencyInvoiceCount).toBe(1);
    expect(o.topOverdueCustomers.map((c) => c.contactId)).toEqual(["c-2", "c-1"]);
  });

  it("customer outstanding is the sum of its invoices — no double counting", () => {
    const b = customerBalances(invoices, [], [], TODAY, "INR");
    expect(b.get("c-1")).toMatchObject({ outstandingPaise: 300_00, overduePaise: 300_00, openInvoices: 2 });
    expect(b.get("c-2")).toMatchObject({ outstandingPaise: 1100_00, overduePaise: 300_00, maxDaysOverdue: 91 });
    expect(b.get("c-3")).toBeUndefined();
  });

  it("lists overdue invoices that have no follow-up since they fell due", () => {
    const followUps = [
      makeFollowUp({ contact_id: "c-1", invoice_id: invoices[1].id, occurred_at: "2026-10-15T06:00:00Z" }),
      makeFollowUp({ contact_id: "c-2", occurred_at: "2026-07-01T06:00:00Z" }), // before due → doesn't count
    ];
    const o = buildOverview({ invoices, payments: [], followUps, today: TODAY, timeZone: TZ, currency: "INR" });
    expect(o.overdueWithoutFollowUp.map((i) => i.id)).toEqual([invoices[2].id, invoices[0].id]);
  });

  it("reports the last payment and next follow-up per customer", () => {
    const payments = [
      makePayment({ invoice_id: invoices[2].id, paid_on: "2026-09-10" }),
      makePayment({ invoice_id: invoices[2].id, paid_on: "2026-10-02", voided_at: "2026-10-03T00:00:00Z", void_reason: "x" }),
    ];
    const followUps = [makeFollowUp({ contact_id: "c-2", next_follow_up_on: "2026-11-03" })];
    const b = customerBalances(invoices, payments, followUps, TODAY, "INR");
    expect(b.get("c-2")).toMatchObject({ lastPaymentOn: "2026-09-10", nextFollowUpOn: "2026-11-03" });
  });
});

describe("promises", () => {
  const inv = makeInvoice({ id: "inv-p", contact_id: "c-9", total_paise: 10_000_00, due_date: "2026-10-01" });
  const promise = (date: string, paise: number) =>
    makeFollowUp({
      contact_id: "c-9",
      invoice_id: "inv-p",
      status: "promise_to_pay",
      promise_date: date,
      promised_paise: paise,
      occurred_at: "2026-10-20T06:00:00Z",
    });

  it("records state pending → due today → missed as days pass", () => {
    const f = [promise("2026-10-30", 5_000_00)];
    const at = (today: string) =>
      evaluatePromises({ followUps: f, invoices: [inv], payments: [], today, timeZone: TZ })[0].state;
    expect(at("2026-10-29")).toBe("pending");
    expect(at("2026-10-30")).toBe("due_today");
    expect(at("2026-10-31")).toBe("missed");
  });

  it("is kept when payments since the promise cover the promised amount", () => {
    const payments = [makePayment({ invoice_id: "inv-p", amount_paise: 5_000_00, paid_on: "2026-10-25" })];
    const paidInv = { ...inv, paid_paise: 5_000_00, outstanding_paise: 5_000_00 };
    const [e] = evaluatePromises({ followUps: [promise("2026-10-30", 5_000_00)], invoices: [paidInv], payments, today: TODAY, timeZone: TZ });
    expect(e.state).toBe("kept");
  });

  it("payments made before the promise, voided payments and credit notes do not keep it", () => {
    const payments = [
      makePayment({ invoice_id: "inv-p", amount_paise: 5_000_00, paid_on: "2026-10-19" }),
      makePayment({ invoice_id: "inv-p", amount_paise: 5_000_00, paid_on: "2026-10-25", voided_at: "2026-10-26T00:00:00Z", void_reason: "bounced" }),
      makePayment({ invoice_id: "inv-p", amount_paise: 5_000_00, paid_on: "2026-10-25", kind: "credit_note" }),
    ];
    const [e] = evaluatePromises({ followUps: [promise("2026-10-30", 5_000_00)], invoices: [inv], payments, today: TODAY, timeZone: TZ });
    expect(e.state).toBe("missed");
  });

  it("is settled once the invoice owes nothing", () => {
    const settled = { ...inv, paid_paise: 10_000_00, outstanding_paise: 0 };
    const [e] = evaluatePromises({ followUps: [promise("2026-10-30", 1_00)], invoices: [settled], payments: [], today: TODAY, timeZone: TZ });
    expect(e.state).toBe("settled");
  });
});

describe("daily follow-up queue", () => {
  const customers = ["c-a", "c-b", "c-c", "c-d", "c-e"].map((id) => makeCustomer({ id }));
  const base = { payments: [], customers, today: TODAY, timeZone: TZ, currency: "INR" };

  it("an overdue invoice appears in the queue with explained reasons", () => {
    const invoices = [makeInvoice({ contact_id: "c-a", total_paise: 50_000_00, due_date: "2026-10-01" })];
    const q = buildFollowUpQueue({ ...base, invoices, followUps: [] });
    expect(q.items).toHaveLength(1);
    expect(q.items[0].contactId).toBe("c-a");
    expect(q.items[0].reasons.map((r) => r.code)).toEqual(["overdue_days", "overdue_amount", "never_contacted"]);
  });

  it("paid and not-yet-due invoices do not appear", () => {
    const invoices = [
      makeInvoice({ contact_id: "c-a", total_paise: 100, paid_paise: 100, due_date: "2026-09-01" }),
      makeInvoice({ contact_id: "c-b", due_date: "2026-11-15" }),
    ];
    expect(buildFollowUpQueue({ ...base, invoices, followUps: [] }).items).toEqual([]);
  });

  it("a missed promise resurfaces the customer automatically, even when snoozed", () => {
    const invoices = [makeInvoice({ id: "inv-m", contact_id: "c-b", due_date: "2026-11-20" })]; // not overdue
    const followUps = [
      makeFollowUp({
        contact_id: "c-b",
        invoice_id: "inv-m",
        status: "promise_to_pay",
        promise_date: "2026-10-29",
        promised_paise: 1_000_00,
        next_follow_up_on: "2026-11-10",
        occurred_at: "2026-10-25T06:00:00Z",
      }),
    ];
    const q = buildFollowUpQueue({ ...base, invoices, followUps });
    expect(q.items.map((i) => i.contactId)).toEqual(["c-b"]);
    expect(q.items[0].reasons.map((r) => r.code)).toContain("promise_missed");
    expect(q.items[0].missedPromises).toBe(1);
  });

  it("orders by deterministic score: older, larger, broken promises first", () => {
    const invoices = [
      makeInvoice({ contact_id: "c-a", total_paise: 1_000_00, due_date: "2026-10-29" }), // 2 days, small
      makeInvoice({ contact_id: "c-b", total_paise: 5_00_000_00, due_date: "2026-08-01" }), // 91 days, large
      makeInvoice({ contact_id: "c-c", total_paise: 50_000_00, due_date: "2026-10-01" }), // 30 days
    ];
    const q = buildFollowUpQueue({ ...base, invoices, followUps: [] });
    expect(q.items.map((i) => i.contactId)).toEqual(["c-b", "c-c", "c-a"]);
    expect(q.items[0].score).toBeGreaterThan(q.items[1].score);
  });

  it("snoozes customers with a future follow-up date and demotes recent contact", () => {
    const invoices = [
      makeInvoice({ contact_id: "c-a", due_date: "2026-10-01" }),
      makeInvoice({ contact_id: "c-b", due_date: "2026-10-01" }),
      makeInvoice({ contact_id: "c-c", due_date: "2026-10-01" }),
    ];
    const followUps = [
      makeFollowUp({ contact_id: "c-a", next_follow_up_on: "2026-11-05", occurred_at: "2026-10-30T06:00:00Z" }),
      makeFollowUp({ contact_id: "c-b", occurred_at: "2026-10-30T06:00:00Z" }),
    ];
    const q = buildFollowUpQueue({ ...base, invoices, followUps });
    expect(q.snoozed).toEqual([{ contactId: "c-a", until: "2026-11-05" }]);
    expect(q.items.map((i) => i.contactId)).toEqual(["c-c", "c-b"]);
    expect(q.items[1].reasons.map((r) => r.code)).toContain("recently_contacted");
  });

  it("a scheduled follow-up that is due brings the customer back", () => {
    const invoices = [makeInvoice({ contact_id: "c-d", due_date: "2026-10-01" })];
    const followUps = [makeFollowUp({ contact_id: "c-d", next_follow_up_on: "2026-10-31", occurred_at: "2026-10-30T06:00:00Z" })];
    const q = buildFollowUpQueue({ ...base, invoices, followUps });
    expect(q.items[0].reasons.map((r) => r.code)).toContain("follow_up_due");
    expect(q.items[0].reasons.map((r) => r.code)).not.toContain("recently_contacted");
  });

  it("disputed customers go to a separate list instead of being chased", () => {
    const invoices = [makeInvoice({ contact_id: "c-e", due_date: "2026-09-01" })];
    const followUps = [makeFollowUp({ contact_id: "c-e", status: "disputed", dispute_reason: "Short supply" })];
    const q = buildFollowUpQueue({ ...base, invoices, followUps });
    expect(q.items).toEqual([]);
    expect(q.disputed.map((i) => i.contactId)).toEqual(["c-e"]);
  });

  it("is idempotent: rebuilding from the same rows yields the same queue", () => {
    const invoices = [makeInvoice({ contact_id: "c-a", due_date: "2026-10-01" }), makeInvoice({ contact_id: "c-b", due_date: "2026-09-01" })];
    const a = buildFollowUpQueue({ ...base, invoices, followUps: [] });
    const b = buildFollowUpQueue({ ...base, invoices, followUps: [] });
    expect(b).toEqual(a);
  });
});
