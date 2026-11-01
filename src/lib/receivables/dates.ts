/**
 * Calendar-date helpers. Business logic works on ISO `YYYY-MM-DD`
 * strings evaluated in the business's timezone — never on the
 * browser's local clock — so "overdue today" means the same thing for
 * every member of the account wherever they are.
 */

export const DEFAULT_TIMEZONE = "Asia/Kolkata";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Today's calendar date in `tz`, e.g. "2026-10-31". */
export function todayInTimeZone(tz: string, now: Date = new Date()): string {
  const zone = isValidTimeZone(tz) ? tz : DEFAULT_TIMEZONE;
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Calendar date of an ISO timestamp as seen in `tz`. */
export function dateInTimeZone(timestamp: string, tz: string): string {
  return todayInTimeZone(tz, new Date(timestamp));
}

function toUtcMs(iso: string): number {
  const m = ISO_DATE.exec(iso);
  if (!m) throw new RangeError(`not an ISO date: ${iso}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / 86_400_000);
}

export function addDays(iso: string, days: number): string {
  return new Date(toUtcMs(iso) + days * 86_400_000).toISOString().slice(0, 10);
}

export function isIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function build(y: number, m: number, d: number): string | null {
  if (y < 100) y += y >= 70 ? 1900 : 2000;
  const iso = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return isIsoDate(iso) ? iso : null;
}

/**
 * Parse the date formats Indian spreadsheets and Tally/Busy exports use.
 * Day-first is assumed for numeric dates (DD/MM/YYYY), as is standard
 * in India. Returns null for anything ambiguous or impossible.
 *
 *   2026-04-05 · 05/04/2026 · 5-4-26 · 05.04.2026 · 5-Apr-2026 · 5 Apr 26 · Apr 5, 2026
 */
export function parseFlexibleDate(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.trim().replace(/\s+/g, " ");
  if (!s) return null;

  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) return build(Number(m[1]), Number(m[2]), Number(m[3]));

  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s);
  if (m) return build(Number(m[3]), Number(m[2]), Number(m[1]));

  m = /^(\d{1,2})[-/. ]([A-Za-z]{3,9})[-/., ]+(\d{2}|\d{4})$/.exec(s);
  if (m) {
    const month = MONTHS[m[2].toLowerCase().slice(0, 3)];
    return month ? build(Number(m[3]), month, Number(m[1])) : null;
  }

  m = /^([A-Za-z]{3,9}) (\d{1,2}),? (\d{4})$/.exec(s);
  if (m) {
    const month = MONTHS[m[1].toLowerCase().slice(0, 3)];
    return month ? build(Number(m[3]), month, Number(m[2])) : null;
  }
  return null;
}

/** "5 Feb 2026" — the format used in reminders and lists. */
export function formatDisplayDate(iso: string, locale = "en-IN"): string {
  if (!isIsoDate(iso)) return iso;
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(toUtcMs(iso)));
}

/** "31 Oct 2026, 3:15 pm" in the business timezone. */
export function formatDisplayDateTime(timestamp: string, tz: string, locale = "en-IN"): string {
  const zone = isValidTimeZone(tz) ? tz : DEFAULT_TIMEZONE;
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: zone,
  }).format(new Date(timestamp));
}
