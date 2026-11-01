import { describe, expect, it } from "vitest";
import {
  addDays,
  dateInTimeZone,
  daysBetween,
  formatDisplayDate,
  isIsoDate,
  parseFlexibleDate,
  todayInTimeZone,
} from "./dates";
import { MAX_PAISE, formatPaise, paiseToDecimalString, parseAmountToPaise, sumPaise } from "./money";
import { mailtoLink, normalizeIndianPhone, phoneKey, smsLink, whatsAppLink } from "./phone";

describe("parseAmountToPaise", () => {
  it.each([
    ["1234", 1234_00],
    ["1,23,456.50", 1_23_456_50],
    ["₹ 1,234", 1234_00],
    ["Rs. 1,234/-", 1234_00],
    ["INR 99.5", 99_50],
    ["12.500", 12_50],
    ["0.01", 1],
    ["1234.00 Dr", 1234_00],
  ])("%s → %d paise", (input, paise) => {
    expect(parseAmountToPaise(input)).toEqual({ ok: true, paise });
  });

  it.each([
    ["", "empty"],
    ["-500", "negative"],
    ["(1,234.00)", "negative"],
    ["500 Cr", "negative"],
    ["0", "zero"],
    ["12.345", "too_many_decimals"],
    ["abc", "invalid"],
    ["1.2.3", "invalid"],
    ["99999999999999", "too_large"],
  ])("%s → %s", (input, error) => {
    expect(parseAmountToPaise(input)).toEqual({ ok: false, error });
  });

  it("never produces float artefacts", () => {
    expect(parseAmountToPaise("0.29")).toEqual({ ok: true, paise: 29 });
    expect(parseAmountToPaise("1.10")).toEqual({ ok: true, paise: 110 });
  });

  it("matches the database upper bound", () => {
    expect(parseAmountToPaise("1000000000000")).toEqual({ ok: true, paise: MAX_PAISE });
  });
});

describe("formatting", () => {
  it("uses Indian digit grouping and hides zero paise", () => {
    expect(formatPaise(1_23_456_00)).toBe("₹1,23,456");
    expect(formatPaise(1_23_456_50)).toBe("₹1,23,456.50");
  });

  it("decimal strings are exact", () => {
    expect(paiseToDecimalString(1_23_456_05)).toBe("123456.05");
    expect(paiseToDecimalString(7)).toBe("0.07");
  });

  it("sums refuse to lose precision", () => {
    expect(sumPaise([1, 2, 3])).toBe(6);
    expect(() => sumPaise([Number.MAX_SAFE_INTEGER, 10])).toThrow(RangeError);
  });
});

describe("dates", () => {
  it("evaluates 'today' in the business timezone, not UTC", () => {
    // 20:00 UTC on 31 Oct is already 1 Nov in India.
    const now = new Date("2026-10-31T20:00:00Z");
    expect(todayInTimeZone("Asia/Kolkata", now)).toBe("2026-11-01");
    expect(todayInTimeZone("UTC", now)).toBe("2026-10-31");
    expect(dateInTimeZone("2026-10-31T20:00:00Z", "Asia/Kolkata")).toBe("2026-11-01");
  });

  it("falls back to India time for an invalid timezone", () => {
    expect(todayInTimeZone("Not/AZone", new Date("2026-10-31T20:00:00Z"))).toBe("2026-11-01");
  });

  it("counts calendar days", () => {
    expect(daysBetween("2026-10-01", "2026-10-31")).toBe(30);
    expect(daysBetween("2026-03-01", "2026-02-28")).toBe(-1);
    expect(addDays("2026-12-25", 10)).toBe("2027-01-04");
  });

  it.each([
    ["2026-04-05", "2026-04-05"],
    ["05/04/2026", "2026-04-05"],
    ["5-4-26", "2026-04-05"],
    ["05.04.2026", "2026-04-05"],
    ["5-Apr-2026", "2026-04-05"],
    ["5 Apr 26", "2026-04-05"],
    ["5-Sept-2026", "2026-09-05"],
    ["Apr 5, 2026", "2026-04-05"],
  ])("parses %s day-first", (input, iso) => {
    expect(parseFlexibleDate(input)).toBe(iso);
  });

  it.each(["31/02/2026", "13/13/2026", "2026-02-30", "yesterday", "", "5-Foo-2026"])("rejects %s", (input) => {
    expect(parseFlexibleDate(input)).toBeNull();
  });

  it("validates ISO dates and formats them for display", () => {
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(formatDisplayDate("2026-02-05")).toBe("5 Feb 2026");
  });
});

describe("phones and send links", () => {
  it.each([
    ["9876543210", "+919876543210"],
    ["09876543210", "+919876543210"],
    ["919876543210", "+919876543210"],
    ["+91 98765-43210", "+919876543210"],
    ["0091 98765 43210", "+919876543210"],
    ["+971 50 123 4567", "+971501234567"],
  ])("normalises %s", (input, e164) => {
    const r = normalizeIndianPhone(input);
    expect(r.ok && r.e164).toBe(e164);
  });

  it.each(["12345", "5876543210", "+91 12345 67890", "", "phone"])("rejects %s", (input) => {
    expect(normalizeIndianPhone(input).ok).toBe(false);
  });

  it("phone keys match the contacts.phone_normalized format", () => {
    expect(phoneKey("98765 43210")).toBe("919876543210");
  });

  it("builds wa.me / sms / mailto links with the text encoded", () => {
    expect(whatsAppLink("9876543210", "Namaste & ₹100")).toBe(
      "https://wa.me/919876543210?text=Namaste%20%26%20%E2%82%B9100",
    );
    expect(smsLink("9876543210", "Hi")).toBe("sms:+919876543210?&body=Hi");
    expect(mailtoLink("a@b.in", "S", "B")).toBe("mailto:a%40b.in?subject=S&body=B");
    expect(whatsAppLink("", "x")).toBeNull();
    expect(mailtoLink("not-an-email", "S", "B")).toBeNull();
  });
});
