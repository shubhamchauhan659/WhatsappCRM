/**
 * Money helpers. Every amount is an integer number of paise (1/100 of
 * the currency unit). Parsing is string-based so "0.1 + 0.2" style
 * float errors can never leak into a stored amount.
 */

/** Matches the database CHECK: 10^14 paise = ₹1 lakh crore. */
export const MAX_PAISE = 100_000_000_000_000;

export type AmountParseError = "empty" | "invalid" | "negative" | "zero" | "too_many_decimals" | "too_large";

export type AmountParseResult = { ok: true; paise: number } | { ok: false; error: AmountParseError };

/**
 * Parse a human/Excel amount into paise.
 * Accepts: "1234", "1,23,456.50", "₹ 1,234", "Rs. 1,234/-", "INR 99.5", "1234.00 Dr".
 * Rejects: negatives, more than 2 decimals, ambiguous text.
 */
export function parseAmountToPaise(input: string | number | null | undefined): AmountParseResult {
  if (input === null || input === undefined) return { ok: false, error: "empty" };
  let s = String(input).trim();
  if (s === "") return { ok: false, error: "empty" };

  // Accounting negatives: "(1,234.00)" or "-1234" or "1234 Cr" (credit balance).
  if (/^\(.*\)$/.test(s) || /^-/.test(s) || /\bcr\.?$/i.test(s)) return { ok: false, error: "negative" };

  s = s
    .replace(/\b(dr|dr\.)$/i, "")
    .replace(/^(inr|rs\.?|₹)\s*/i, "")
    .replace(/\s*(inr|\/-)$/i, "")
    .replace(/[\s,]/g, "");
  if (s.startsWith("₹")) s = s.slice(1);

  const m = /^(\d+)(?:\.(\d*))?$/.exec(s);
  if (!m) return { ok: false, error: "invalid" };
  const whole = m[1];
  const frac = m[2] ?? "";
  if (frac.length > 2) {
    // Allow trailing zeros beyond 2 places ("12.500") but not real precision.
    if (/^\d{2}0+$/.test(frac)) return parseAmountToPaise(`${whole}.${frac.slice(0, 2)}`);
    return { ok: false, error: "too_many_decimals" };
  }
  if (whole.replace(/^0+/, "").length > 13) return { ok: false, error: "too_large" };
  const paise = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  if (!Number.isSafeInteger(paise)) return { ok: false, error: "too_large" };
  if (paise === 0) return { ok: false, error: "zero" };
  if (paise > MAX_PAISE) return { ok: false, error: "too_large" };
  return { ok: true, paise };
}

/** "1234.50" — for inputs and CSV exports (no grouping, always 2 decimals). */
export function paiseToDecimalString(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(paise));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

const formatterCache = new Map<string, Intl.NumberFormat>();

function formatter(currency: string, locale: string, fractionDigits: 0 | 2): Intl.NumberFormat {
  const key = `${locale}|${currency}|${fractionDigits}`;
  let f = formatterCache.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
      });
    } catch {
      f = new Intl.NumberFormat(locale, {
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
      });
    }
    formatterCache.set(key, f);
  }
  return f;
}

/**
 * "₹1,23,456" or "₹1,23,456.50" (Indian digit grouping by default).
 * Paise are shown only when non-zero, so whole-rupee amounts stay short.
 */
export function formatPaise(paise: number, currency = "INR", locale = "en-IN"): string {
  const digits: 0 | 2 = Math.abs(paise) % 100 === 0 ? 0 : 2;
  return formatter(currency, locale, digits).format(paise / 100);
}

/** Sum that refuses to silently lose precision. */
export function sumPaise(values: Iterable<number>): number {
  let total = 0;
  for (const v of values) {
    total += v;
    if (!Number.isSafeInteger(total)) throw new RangeError("paise sum exceeded safe integer range");
  }
  return total;
}
