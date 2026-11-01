/**
 * Payment-reminder drafts — deterministic templates, no AI required.
 *
 * Three languages (English, Hinglish = Roman Hindi, Hindi = Devanagari)
 * × three tones (polite, standard, firm) × two scopes (one invoice, or
 * a statement of several). Every tone stays professional: no threats,
 * no legal language, no shaming — enforced by a unit test.
 *
 * Rendering is strict. A placeholder whose value is missing, or a
 * placeholder we do not know, is left visibly in the text and reported,
 * and the composer refuses to send until it is resolved. Amount values
 * are only ever produced from stored outstanding balances, and
 * findUnexpectedAmounts() flags any ₹ figure typed into an edited
 * message that does not match a real balance.
 */
import { formatDisplayDate } from "./dates";
import { formatPaise, parseAmountToPaise } from "./money";
import { daysOverdue } from "./status";
import type { BusinessProfile, CustomerRow, InvoiceRow } from "./types";

export const REMINDER_LANGUAGES = ["en", "hinglish", "hi"] as const;
export type ReminderLanguage = (typeof REMINDER_LANGUAGES)[number];
export const REMINDER_TONES = ["polite", "standard", "firm"] as const;
export type ReminderTone = (typeof REMINDER_TONES)[number];
export type ReminderScope = "single" | "multiple";

export const REMINDER_VARIABLES = [
  "customer_name",
  "business_name",
  "invoice_number",
  "outstanding_amount",
  "due_date",
  "days_overdue",
  "total_outstanding",
  "invoice_count",
  "invoice_list",
  "upi_id",
  "business_phone",
] as const;
export type ReminderVariable = (typeof REMINDER_VARIABLES)[number];
export type ReminderVariables = Partial<Record<ReminderVariable, string>>;

type TemplateSet = Record<ReminderTone, Record<ReminderScope, string>>;

const EN: TemplateSet = {
  polite: {
    single:
      "Hello {{customer_name}},\n\nThis is a gentle reminder from {{business_name}} that invoice {{invoice_number}} for {{outstanding_amount}} was due on {{due_date}}. Could you please confirm the payment status?\n\nIf you have already paid, please ignore this message. Thank you.",
    multiple:
      "Hello {{customer_name}},\n\nThis is a gentle reminder from {{business_name}} that {{invoice_count}} invoices totalling {{total_outstanding}} are pending:\n{{invoice_list}}\n\nCould you please confirm when we can expect the payment? If you have already paid, please ignore this message. Thank you.",
  },
  standard: {
    single:
      "Dear {{customer_name}},\n\nInvoice {{invoice_number}} has an outstanding balance of {{outstanding_amount}}, which was due on {{due_date}} ({{days_overdue}} days ago). Please arrange the payment at the earliest and share the payment details once done.\n\nIf the payment has already been made, please ignore this reminder.\n\nThank you,\n{{business_name}}",
    multiple:
      "Dear {{customer_name}},\n\nThe following invoices totalling {{total_outstanding}} are past their due date:\n{{invoice_list}}\n\nPlease arrange the payment at the earliest and share the payment details once done. If the payment has already been made, please ignore this reminder.\n\nThank you,\n{{business_name}}",
  },
  firm: {
    single:
      "Dear {{customer_name}},\n\nOur records show that invoice {{invoice_number}} for {{outstanding_amount}} is now {{days_overdue}} days overdue (due date: {{due_date}}). We request you to clear this payment within the next 3 working days, or let us know a confirmed payment date.\n\nIf you have already paid, please share the transaction reference so we can update our records.\n\nRegards,\n{{business_name}}",
    multiple:
      "Dear {{customer_name}},\n\nOur records show {{invoice_count}} overdue invoices totalling {{total_outstanding}}:\n{{invoice_list}}\n\nWe request you to clear these payments within the next 3 working days, or let us know a confirmed payment date. If you have already paid, please share the transaction reference so we can update our records.\n\nRegards,\n{{business_name}}",
  },
};

const HINGLISH: TemplateSet = {
  polite: {
    single:
      "Namaste {{customer_name}}, invoice {{invoice_number}} ke {{outstanding_amount}} payment ki due date {{due_date}} thi. Kripya payment status confirm kar dein. Agar payment already ho chuki hai, please ignore this reminder. Dhanyavaad.\n\n{{business_name}}",
    multiple:
      "Namaste {{customer_name}}, {{business_name}} ki taraf se reminder: aapke {{invoice_count}} invoices ka total {{total_outstanding}} pending hai:\n{{invoice_list}}\n\nKripya payment status confirm kar dein. Agar payment already ho chuki hai, please ignore this reminder. Dhanyavaad.",
  },
  standard: {
    single:
      "Namaste {{customer_name}} ji,\n\n{{business_name}} ki taraf se reminder: invoice {{invoice_number}} ka {{outstanding_amount}} payment {{due_date}} ko due tha ({{days_overdue}} din ho gaye hain). Kripya jaldi payment karke details share kar dein.\n\nAgar payment ho chuki hai, toh is message ko ignore karein. Dhanyavaad.",
    multiple:
      "Namaste {{customer_name}} ji,\n\n{{business_name}} ki taraf se reminder: neeche diye gaye invoices ka total {{total_outstanding}} due date ke baad bhi pending hai:\n{{invoice_list}}\n\nKripya jaldi payment karke details share kar dein. Agar payment ho chuki hai, toh is message ko ignore karein. Dhanyavaad.",
  },
  firm: {
    single:
      "Namaste {{customer_name}} ji,\n\nHamare records ke anusaar invoice {{invoice_number}} ka {{outstanding_amount}} payment {{days_overdue}} din se overdue hai (due date: {{due_date}}). Kripya agle 3 working days mein payment clear karein, ya confirmed payment date batayein.\n\nAgar payment ho chuki hai, toh transaction reference share karein taaki hum records update kar sakein.\n\nDhanyavaad,\n{{business_name}}",
    multiple:
      "Namaste {{customer_name}} ji,\n\nHamare records ke anusaar aapke {{invoice_count}} invoices ka total {{total_outstanding}} overdue hai:\n{{invoice_list}}\n\nKripya agle 3 working days mein payment clear karein, ya confirmed payment date batayein. Agar payment ho chuki hai, toh transaction reference share karein taaki hum records update kar sakein.\n\nDhanyavaad,\n{{business_name}}",
  },
};

const HI: TemplateSet = {
  polite: {
    single:
      "नमस्ते {{customer_name}} जी,\n\n{{business_name}} की ओर से विनम्र अनुस्मारक: इनवॉइस {{invoice_number}} की राशि {{outstanding_amount}} की देय तिथि {{due_date}} थी। कृपया भुगतान की स्थिति बताएं।\n\nयदि भुगतान हो चुका है, तो कृपया इस संदेश को अनदेखा करें। धन्यवाद।",
    multiple:
      "नमस्ते {{customer_name}} जी,\n\n{{business_name}} की ओर से विनम्र अनुस्मारक: आपके {{invoice_count}} इनवॉइस की कुल राशि {{total_outstanding}} बकाया है:\n{{invoice_list}}\n\nकृपया बताएं कि भुगतान कब तक हो पाएगा। यदि भुगतान हो चुका है, तो कृपया इस संदेश को अनदेखा करें। धन्यवाद।",
  },
  standard: {
    single:
      "नमस्ते {{customer_name}} जी,\n\nइनवॉइस {{invoice_number}} की बकाया राशि {{outstanding_amount}} है, जिसकी देय तिथि {{due_date}} थी ({{days_overdue}} दिन पहले)। कृपया जल्द से जल्द भुगतान करें और भुगतान का विवरण साझा करें।\n\nयदि भुगतान हो चुका है, तो कृपया इस संदेश को अनदेखा करें।\n\nधन्यवाद,\n{{business_name}}",
    multiple:
      "नमस्ते {{customer_name}} जी,\n\nनीचे दिए गए इनवॉइस की कुल राशि {{total_outstanding}} देय तिथि के बाद भी बकाया है:\n{{invoice_list}}\n\nकृपया जल्द से जल्द भुगतान करें और भुगतान का विवरण साझा करें। यदि भुगतान हो चुका है, तो कृपया इस संदेश को अनदेखा करें।\n\nधन्यवाद,\n{{business_name}}",
  },
  firm: {
    single:
      "नमस्ते {{customer_name}} जी,\n\nहमारे रिकॉर्ड के अनुसार इनवॉइस {{invoice_number}} की राशि {{outstanding_amount}} अब {{days_overdue}} दिन से बकाया है (देय तिथि: {{due_date}})। कृपया अगले 3 कार्य दिवसों में भुगतान करें, या भुगतान की पक्की तारीख बताएं।\n\nयदि भुगतान हो चुका है, तो कृपया ट्रांज़ैक्शन रेफ़रेंस साझा करें ताकि हम अपने रिकॉर्ड अपडेट कर सकें।\n\nधन्यवाद,\n{{business_name}}",
    multiple:
      "नमस्ते {{customer_name}} जी,\n\nहमारे रिकॉर्ड के अनुसार आपके {{invoice_count}} इनवॉइस की कुल राशि {{total_outstanding}} देय तिथि के बाद भी बकाया है:\n{{invoice_list}}\n\nकृपया अगले 3 कार्य दिवसों में भुगतान करें, या भुगतान की पक्की तारीख बताएं। यदि भुगतान हो चुका है, तो कृपया ट्रांज़ैक्शन रेफ़रेंस साझा करें ताकि हम अपने रिकॉर्ड अपडेट कर सकें।\n\nधन्यवाद,\n{{business_name}}",
  },
};

const TEMPLATES: Record<ReminderLanguage, TemplateSet> = { en: EN, hinglish: HINGLISH, hi: HI };

const UPI_LINE: Record<ReminderLanguage, string> = {
  en: "You can pay by UPI to: {{upi_id}}",
  hinglish: "UPI se payment ke liye: {{upi_id}}",
  hi: "UPI से भुगतान के लिए: {{upi_id}}",
};

const DUE_WORD: Record<ReminderLanguage, string> = { en: "due", hinglish: "due", hi: "देय" };

const SUBJECT: Record<ReminderLanguage, Record<ReminderScope, string>> = {
  en: { single: "Payment reminder: invoice {{invoice_number}}", multiple: "Payment reminder: pending invoices" },
  hinglish: { single: "Payment reminder: invoice {{invoice_number}}", multiple: "Payment reminder: pending invoices" },
  hi: { single: "भुगतान अनुस्मारक: इनवॉइस {{invoice_number}}", multiple: "भुगतान अनुस्मारक: बकाया इनवॉइस" },
};

/** All built-in template bodies (for tests and the template picker). */
export function allTemplateBodies(): string[] {
  const out: string[] = [];
  for (const lang of REMINDER_LANGUAGES) {
    for (const tone of REMINDER_TONES) {
      out.push(TEMPLATES[lang][tone].single, TEMPLATES[lang][tone].multiple);
    }
    out.push(UPI_LINE[lang]);
  }
  return out;
}

export function getReminderTemplate(
  language: ReminderLanguage,
  tone: ReminderTone,
  scope: ReminderScope,
  options: { includeUpi?: boolean } = {},
): string {
  const body = TEMPLATES[language][tone][scope];
  return options.includeUpi ? `${body}\n\n${UPI_LINE[language]}` : body;
}

export function getReminderSubject(language: ReminderLanguage, scope: ReminderScope): string {
  return SUBJECT[language][scope];
}

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

export interface RenderResult {
  text: string;
  used: ReminderVariable[];
  /** Known placeholders with no value — left in the text as {{name}}. */
  missing: ReminderVariable[];
  /** Placeholders we do not recognise — left in the text as-is. */
  unknown: string[];
}

function isKnownVariable(name: string): name is ReminderVariable {
  return (REMINDER_VARIABLES as readonly string[]).includes(name);
}

export function renderReminder(template: string, vars: ReminderVariables): RenderResult {
  const used = new Set<ReminderVariable>();
  const missing = new Set<ReminderVariable>();
  const unknown = new Set<string>();
  const text = template.replace(PLACEHOLDER, (whole, name: string) => {
    if (!isKnownVariable(name)) {
      unknown.add(name);
      return whole;
    }
    used.add(name);
    const value = vars[name];
    if (value === undefined || value === null || value.trim() === "") {
      missing.add(name);
      return `{{${name}}}`;
    }
    return value;
  });
  return { text, used: [...used], missing: [...missing], unknown: [...unknown] };
}

export interface ReminderContext {
  business: Pick<BusinessProfile, "name" | "business_upi_id" | "business_phone">;
  customer: Pick<CustomerRow, "name" | "company" | "phone">;
  invoices: Pick<
    InvoiceRow,
    "id" | "invoice_number" | "due_date" | "currency" | "status" | "total_paise" | "paid_paise" | "credited_paise" | "outstanding_paise"
  >[];
  today: string;
  language: ReminderLanguage;
}

export type BuildVariablesResult =
  | { ok: true; scope: ReminderScope; variables: ReminderVariables; amountsPaise: number[]; currency: string }
  | { ok: false; error: "no_invoices" | "nothing_outstanding" | "mixed_currency" };

/**
 * Build reminder variables strictly from stored balances. Refuses to
 * build a reminder for an invoice that owes nothing or for a mix of
 * currencies, rather than producing a misleading amount.
 */
export function buildReminderVariables(ctx: ReminderContext): BuildVariablesResult {
  if (ctx.invoices.length === 0) return { ok: false, error: "no_invoices" };
  if (ctx.invoices.some((i) => i.status !== "open" || i.outstanding_paise <= 0)) {
    return { ok: false, error: "nothing_outstanding" };
  }
  const currency = ctx.invoices[0].currency;
  if (ctx.invoices.some((i) => i.currency !== currency)) return { ok: false, error: "mixed_currency" };

  const sorted = [...ctx.invoices].sort((a, b) => a.due_date.localeCompare(b.due_date));
  const total = sorted.reduce((s, i) => s + i.outstanding_paise, 0);
  const customerName = ctx.customer.name?.trim() || ctx.customer.company?.trim() || "";
  const base: ReminderVariables = {
    customer_name: customerName || undefined,
    business_name: ctx.business.name?.trim() || undefined,
    upi_id: ctx.business.business_upi_id?.trim() || undefined,
    business_phone: ctx.business.business_phone?.trim() || undefined,
    total_outstanding: formatPaise(total, currency),
    invoice_count: String(sorted.length),
  };

  if (sorted.length === 1) {
    const inv = sorted[0];
    const days = daysOverdue(inv, ctx.today);
    return {
      ok: true,
      scope: "single",
      currency,
      amountsPaise: [inv.outstanding_paise],
      variables: {
        ...base,
        invoice_number: inv.invoice_number,
        outstanding_amount: formatPaise(inv.outstanding_paise, currency),
        due_date: formatDisplayDate(inv.due_date),
        days_overdue: days > 0 ? String(days) : undefined,
      },
    };
  }

  const dueWord = DUE_WORD[ctx.language];
  const list = sorted
    .map((i) => `• ${i.invoice_number} — ${formatPaise(i.outstanding_paise, currency)} (${dueWord} ${formatDisplayDate(i.due_date)})`)
    .join("\n");
  return {
    ok: true,
    scope: "multiple",
    currency,
    amountsPaise: [total, ...sorted.map((i) => i.outstanding_paise)],
    variables: { ...base, invoice_list: list },
  };
}

const AMOUNT_IN_TEXT = /(?:₹|\bRs\.?|\bINR)\s?(\d[\d,]*(?:\.\d{1,2})?)/gi;

/**
 * Amounts written in the final message that are not one of the real
 * balances. Catches a hand-edited "₹50,000" when the invoice owes
 * ₹5,000 before the message goes out.
 */
export function findUnexpectedAmounts(text: string, allowedPaise: number[]): string[] {
  const allowed = new Set(allowedPaise);
  const unexpected: string[] = [];
  for (const m of text.matchAll(AMOUNT_IN_TEXT)) {
    const parsed = parseAmountToPaise(m[1]);
    if (!parsed.ok || !allowed.has(parsed.paise)) unexpected.push(m[0].trim());
  }
  return unexpected;
}
