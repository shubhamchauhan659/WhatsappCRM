"use client";

/**
 * Reminder editor + preview.
 *
 * The user picks invoices, language and tone; edits the template (with
 * {{placeholders}}); sees every variable and the exact final text; then
 * copies it or opens their own WhatsApp / SMS / email app. Nothing is
 * sent by us. A follow-up is recorded as "reminder sent" only after the
 * user confirms they actually sent it — and only once, thanks to a
 * per-composer client_ref.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, Check, Copy, Loader2, Mail, MessageCircle, Smartphone } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDisplayDate } from "@/lib/receivables/dates";
import { formatPaise } from "@/lib/receivables/money";
import { mailtoLink, smsLink, whatsAppLink } from "@/lib/receivables/phone";
import {
  REMINDER_LANGUAGES,
  REMINDER_TONES,
  buildReminderVariables,
  findUnexpectedAmounts,
  getReminderSubject,
  getReminderTemplate,
  renderReminder,
  type ReminderLanguage,
  type ReminderTone,
} from "@/lib/receivables/reminders";
import { daysOverdue } from "@/lib/receivables/status";
import { customerDisplayName, type FollowUpChannel } from "@/lib/receivables/types";
import { selectClassName } from "./shell";
import { newClientRef, type ReceivablesSnapshot } from "./use-receivables";

const LANG_KEY = "paisafollow.reminderLanguage";

export function ReminderComposer({
  open,
  onOpenChange,
  snapshot,
  contactId,
  preselectInvoiceIds,
  onRecorded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: ReceivablesSnapshot;
  contactId: string;
  preselectInvoiceIds?: string[];
  onRecorded: () => void;
}) {
  const t = useTranslations("Receivables");
  const { accountId } = useAuth();
  const customer = snapshot.customers.get(contactId);
  const openInvoices = useMemo(
    () =>
      snapshot.invoices
        .filter((i) => i.contact_id === contactId && i.status === "open" && i.outstanding_paise > 0 && i.currency === snapshot.currency)
        .sort((a, b) => a.due_date.localeCompare(b.due_date)),
    [snapshot, contactId],
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [language, setLanguage] = useState<ReminderLanguage>("hinglish");
  const [tone, setTone] = useState<ReminderTone>("polite");
  const [includeUpi, setIncludeUpi] = useState(true);
  const [text, setText] = useState("");
  const [edited, setEdited] = useState(false);
  const [pendingChannel, setPendingChannel] = useState<FollowUpChannel | null>(null);
  const [saving, setSaving] = useState(false);
  const [clientRef, setClientRef] = useState(newClientRef);

  const invoices = openInvoices.filter((i) => selected.has(i.id));
  const built = buildReminderVariables({
    business: snapshot.business,
    customer: customer ?? { name: null, company: null, phone: "" },
    invoices,
    today: snapshot.today,
    language,
  });
  const scope = invoices.length > 1 ? "multiple" : "single";
  const hasUpi = !!snapshot.business.business_upi_id;

  useEffect(() => {
    if (!open) return;
    const pre = preselectInvoiceIds?.filter((id) => openInvoices.some((i) => i.id === id)) ?? [];
    const initial = pre.length > 0 ? pre : openInvoices.filter((i) => daysOverdue(i, snapshot.today) > 0).map((i) => i.id);
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(LANG_KEY) : null;
    /* eslint-disable react-hooks/set-state-in-effect -- reset the composer each time it opens */
    setSelected(new Set(initial.length > 0 ? initial : openInvoices.slice(0, 1).map((i) => i.id)));
    if (stored && (REMINDER_LANGUAGES as readonly string[]).includes(stored)) setLanguage(stored as ReminderLanguage);
    setTone("polite");
    setEdited(false);
    setPendingChannel(null);
    setClientRef(newClientRef());
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, preselectInvoiceIds, openInvoices, snapshot.today]);

  // Regenerate the template when its inputs change (unless the user has edited it).
  useEffect(() => {
    if (!open || edited) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- derived default text
    setText(getReminderTemplate(language, tone, scope, { includeUpi: includeUpi && hasUpi }));
  }, [open, edited, language, tone, scope, includeUpi, hasUpi]);

  const rendered = built.ok ? renderReminder(text, built.variables) : null;
  const unexpected = built.ok && rendered ? findUnexpectedAmounts(rendered.text, built.amountsPaise) : [];
  const blockers: string[] = [];
  if (!built.ok) blockers.push(t(`composer.errors.${built.error}`));
  if (rendered?.missing.length) blockers.push(t("composer.errors.missing", { names: rendered.missing.join(", ") }));
  if (rendered?.unknown.length) blockers.push(t("composer.errors.unknown", { names: rendered.unknown.join(", ") }));
  const canSend = blockers.length === 0 && !!rendered;
  const finalText = rendered?.text ?? "";

  const subject = built.ok ? renderReminder(getReminderSubject(language, scope), built.variables).text : "";
  const links = {
    whatsapp: whatsAppLink(customer?.phone, finalText),
    sms: smsLink(customer?.phone, finalText),
    email: mailtoLink(customer?.email, subject, finalText),
  };

  function resetTemplate(next: { language?: ReminderLanguage; tone?: ReminderTone; includeUpi?: boolean }) {
    if (edited && !window.confirm(t("composer.confirmReplace"))) return;
    if (next.language) {
      setLanguage(next.language);
      window.localStorage.setItem(LANG_KEY, next.language);
    }
    if (next.tone) setTone(next.tone);
    if (next.includeUpi !== undefined) setIncludeUpi(next.includeUpi);
    setEdited(false);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(finalText);
      toast.success(t("composer.copied"));
      setPendingChannel("other");
    } catch {
      toast.error(t("composer.copyFailed"));
    }
  }

  function openLink(channel: FollowUpChannel, href: string | null) {
    if (!href) return;
    window.open(href, "_blank", "noopener,noreferrer");
    setPendingChannel(channel);
  }

  async function markSent() {
    if (!pendingChannel || !accountId || !canSend) return;
    setSaving(true);
    const { error } = await createClient()
      .from("follow_ups")
      .insert({
        account_id: accountId,
        contact_id: contactId,
        invoice_id: invoices.length === 1 ? invoices[0].id : null,
        channel: pendingChannel,
        status: "reminder_sent",
        message: finalText.slice(0, 4000),
        summary: t("composer.autoSummary", { count: invoices.length, amount: built.ok ? built.variables.total_outstanding ?? "" : "" }),
        client_ref: clientRef,
      });
    setSaving(false);
    if (error && error.code !== "23505") {
      toast.error(t("common.saveFailed"));
      return;
    }
    toast.success(t("composer.recorded"));
    onRecorded();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto border-border bg-popover text-popover-foreground sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("composer.title")}</DialogTitle>
          <DialogDescription>{t("composer.description", { name: customerDisplayName(customer) })}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid content-start gap-3">
            <fieldset className="grid gap-1.5">
              <legend className="mb-1 text-sm font-medium">{t("composer.invoices")}</legend>
              {openInvoices.length === 0 && <p className="text-xs text-muted-foreground">{t("composer.noOpenInvoices")}</p>}
              {openInvoices.map((inv) => {
                const days = daysOverdue(inv, snapshot.today);
                return (
                  <label key={inv.id} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm">
                    <Checkbox
                      checked={selected.has(inv.id)}
                      onCheckedChange={(checked) =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (checked) next.add(inv.id);
                          else next.delete(inv.id);
                          return next;
                        })
                      }
                      aria-label={inv.invoice_number}
                    />
                    <span className="flex-1 truncate">{inv.invoice_number}</span>
                    <span className="font-medium">{formatPaise(inv.outstanding_paise, inv.currency)}</span>
                    <span className="w-24 text-right text-xs text-muted-foreground">
                      {days > 0 ? t("invoiceState.overdueDays", { days }) : t("composer.dueOn", { date: formatDisplayDate(inv.due_date) })}
                    </span>
                  </label>
                );
              })}
            </fieldset>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="rem-lang">{t("composer.language")}</Label>
                <select id="rem-lang" className={selectClassName} value={language} onChange={(e) => resetTemplate({ language: e.target.value as ReminderLanguage })}>
                  {REMINDER_LANGUAGES.map((l) => (
                    <option key={l} value={l}>
                      {t(`composer.languages.${l}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="rem-tone">{t("composer.tone")}</Label>
                <select id="rem-tone" className={selectClassName} value={tone} onChange={(e) => resetTemplate({ tone: e.target.value as ReminderTone })}>
                  {REMINDER_TONES.map((x) => (
                    <option key={x} value={x}>
                      {t(`composer.tones.${x}`)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {hasUpi && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={includeUpi} onCheckedChange={(c) => resetTemplate({ includeUpi: !!c })} />
                {t("composer.includeUpi", { upi: snapshot.business.business_upi_id ?? "" })}
              </label>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="rem-text">{t("composer.template")}</Label>
              <Textarea
                id="rem-text"
                rows={9}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setEdited(true);
                }}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">{t("composer.templateHint")}</p>
            </div>
          </div>

          <div className="grid content-start gap-3">
            <div>
              <p className="mb-1 text-sm font-medium">{t("composer.variables")}</p>
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-md border border-border p-2.5 text-xs">
                {built.ok &&
                  (rendered?.used ?? []).map((name) => (
                    <div key={name} className="contents">
                      <dt className="font-mono text-muted-foreground">{`{{${name}}}`}</dt>
                      <dd className="whitespace-pre-wrap break-words">
                        {built.variables[name] || <span className="text-destructive">{t("composer.noValue")}</span>}
                      </dd>
                    </div>
                  ))}
              </dl>
            </div>
            <div>
              <p className="mb-1 text-sm font-medium">{t("composer.preview")}</p>
              <div className="whitespace-pre-wrap break-words rounded-lg bg-emerald-50 p-3 text-sm text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-50" aria-live="polite">
                {finalText || t("composer.previewEmpty")}
              </div>
            </div>
            {blockers.length > 0 && (
              <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
                {blockers.map((b) => (
                  <p key={b}>{b}</p>
                ))}
              </div>
            )}
            {unexpected.length > 0 && (
              <div role="alert" className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-900 dark:text-amber-200">
                <AlertTriangle className="size-4 shrink-0" />
                {t("composer.unexpectedAmounts", { amounts: unexpected.join(", ") })}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={!canSend} onClick={copy}>
                <Copy className="size-4" />
                {t("composer.copy")}
              </Button>
              <Button type="button" disabled={!canSend || !links.whatsapp} onClick={() => openLink("whatsapp", links.whatsapp)}>
                <MessageCircle className="size-4" />
                {t("composer.whatsapp")}
              </Button>
              <Button type="button" variant="outline" disabled={!canSend || !links.sms} onClick={() => openLink("sms", links.sms)}>
                <Smartphone className="size-4" />
                {t("composer.sms")}
              </Button>
              <Button type="button" variant="outline" disabled={!canSend || !links.email} onClick={() => openLink("email", links.email)}>
                <Mail className="size-4" />
                {t("composer.email")}
              </Button>
            </div>
            {!customer?.phone && <p className="text-xs text-muted-foreground">{t("composer.noPhone")}</p>}
            {pendingChannel && (
              <div className="grid gap-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
                <p className="text-sm">{t("composer.confirmSent", { channel: t(`channel.${pendingChannel}`) })}</p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" disabled={saving} onClick={markSent}>
                    {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                    {t("composer.yesSent")}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setPendingChannel(null)}>
                    {t("composer.notSent")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
