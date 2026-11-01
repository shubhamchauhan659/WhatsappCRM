/**
 * Phone handling for Indian SMB data plus free "send" links.
 *
 * Spreadsheets carry Indian mobiles as "98765 43210", "09876543210",
 * "919876543210" or "+91-98765-43210". We store `+<country><number>` so
 * the existing `contacts.phone_normalized` (digits only, unique per
 * account) dedupes them against WhatsApp-created contacts, which use
 * the bare wa_id digits ("919876543210").
 */

export type PhoneParseResult = { ok: true; e164: string; digits: string } | { ok: false };

export function normalizeIndianPhone(raw: string | null | undefined): PhoneParseResult {
  if (!raw) return { ok: false };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false };
  const hasPlus = trimmed.startsWith("+") || trimmed.startsWith("00");
  let digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("00")) digits = digits.slice(2);

  if (!hasPlus) {
    if (/^0[6-9]\d{9}$/.test(digits)) digits = `91${digits.slice(1)}`;
    else if (/^[6-9]\d{9}$/.test(digits)) digits = `91${digits}`;
    else if (!/^91[6-9]\d{9}$/.test(digits)) return { ok: false };
  }

  if (digits.startsWith("91")) {
    if (!/^91[6-9]\d{9}$/.test(digits)) return { ok: false };
  } else if (!/^[1-9]\d{7,14}$/.test(digits)) {
    return { ok: false };
  }
  return { ok: true, e164: `+${digits}`, digits };
}

/** Digits-only key that matches `contacts.phone_normalized`. */
export function phoneKey(raw: string | null | undefined): string | null {
  const parsed = normalizeIndianPhone(raw);
  if (parsed.ok) return parsed.digits;
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length >= 8 ? digits : null;
}

/**
 * WhatsApp click-to-chat (official, free, no API): opens the user's own
 * WhatsApp / WhatsApp Business app with the message pre-filled. The
 * user presses send — nothing is sent on their behalf.
 */
export function whatsAppLink(phone: string | null | undefined, text: string): string | null {
  const key = phoneKey(phone);
  if (!key) return null;
  return `https://wa.me/${key}?text=${encodeURIComponent(text)}`;
}

/** `sms:` link; the `?&body=` form works on both iOS and Android. */
export function smsLink(phone: string | null | undefined, text: string): string | null {
  const key = phoneKey(phone);
  if (!key) return null;
  return `sms:+${key}?&body=${encodeURIComponent(text)}`;
}

export function telLink(phone: string | null | undefined): string | null {
  const key = phoneKey(phone);
  return key ? `tel:+${key}` : null;
}

export function mailtoLink(email: string | null | undefined, subject: string, body: string): string | null {
  const addr = email?.trim();
  if (!addr || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) return null;
  return `mailto:${encodeURIComponent(addr)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
