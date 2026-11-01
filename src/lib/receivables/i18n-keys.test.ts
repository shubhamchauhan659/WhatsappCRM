/**
 * next-intl renders a missing key as its own key path instead of
 * failing, and the existing parity test only compares locales with
 * each other. This guards the receivables UI: every literal t('…') key
 * must exist in en.json, and every dynamic t(`prefix.${x}`) prefix must
 * be an existing group.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const messages = JSON.parse(readFileSync(join(root, "messages", "en.json"), "utf8"));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return files(full);
    return full.endsWith(".tsx") ? [full] : [];
  });
}

function resolve(path: string): unknown {
  return path.split(".").reduce<unknown>((node, key) => (node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined), messages);
}

const sources = [
  ...files(join(root, "src", "components", "receivables")),
  ...files(join(root, "src", "app", "(dashboard)", "receivables")),
  join(root, "src", "components", "settings", "business-settings.tsx"),
];

describe("receivables translations", () => {
  it("scans the receivables UI", () => {
    expect(sources.length).toBeGreaterThan(10);
  });

  it.each(sources.map((s) => [s.replace(`${root}/`, ""), s]))("%s uses only existing keys", (_label, file) => {
    const text = readFileSync(file, "utf8");
    const ns = /const t = useTranslations\(\s*["']([^"']+)["']\s*\)/.exec(text)?.[1];
    if (!ns) return;
    const missing: string[] = [];
    for (const m of text.matchAll(/(?<![.\w])t\(\s*(["'])([^"'`]+)\1/g)) {
      if (typeof resolve(`${ns}.${m[2]}`) !== "string") missing.push(m[2]);
    }
    for (const m of text.matchAll(/(?<![.\w])t\(\s*`([^`$]*)\$\{/g)) {
      const prefix = m[1].replace(/\.$/, "");
      const node = resolve(`${ns}.${prefix}`);
      if (!node || typeof node !== "object") missing.push(`${prefix}.*`);
    }
    expect(missing).toEqual([]);
  });

  it("enumerated groups cover every value the code can produce", async () => {
    const types = await import("./types");
    const reminders = await import("./reminders");
    const r = messages.Receivables;
    for (const s of types.FOLLOW_UP_STATUSES) expect(r.followUpStatus[s], s).toBeTypeOf("string");
    for (const c of types.FOLLOW_UP_CHANNELS) expect(r.channel[c], c).toBeTypeOf("string");
    for (const m of types.PAYMENT_METHODS) expect(r.paymentMethod[m], m).toBeTypeOf("string");
    for (const l of reminders.REMINDER_LANGUAGES) expect(r.composer.languages[l], l).toBeTypeOf("string");
    for (const x of reminders.REMINDER_TONES) expect(r.composer.tones[x], x).toBeTypeOf("string");
    for (const s of ["settled", "kept", "pending", "due_today", "missed"]) expect(r.promiseState[s], s).toBeTypeOf("string");
    for (const s of ["paid", "partially_paid", "unpaid", "cancelled"]) expect(r.invoiceState[s], s).toBeTypeOf("string");
  });
});
