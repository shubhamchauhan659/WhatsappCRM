"use client";

/**
 * Write dialogs for the receivables module: invoice, payment / credit
 * note, void payment, and follow-up. Validation here is for fast
 * feedback; the database (migration 060) enforces every invariant
 * again, so a bypassed client still cannot over-pay an invoice or
 * write into another business.
 */
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { addDays, isIsoDate } from "@/lib/receivables/dates";
import { formatPaise, paiseToDecimalString, parseAmountToPaise } from "@/lib/receivables/money";
import { normalizeIndianPhone } from "@/lib/receivables/phone";
import {
  CUSTOMER_COLUMNS,
  FOLLOW_UP_CHANNELS,
  FOLLOW_UP_STATUSES,
  PAYMENT_METHODS,
  customerDisplayName,
  type CustomerRow,
  type FollowUpChannel,
  type FollowUpStatus,
  type InvoiceRow,
  type PaymentKind,
  type PaymentMethod,
  type PaymentRow,
} from "@/lib/receivables/types";
import { selectClassName } from "./shell";
import { newClientRef, type ReceivablesSnapshot } from "./use-receivables";

type PgError = { code?: string; message?: string } | null;

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  saving,
  onSubmit,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  submitLabel: string;
  saving: boolean;
  onSubmit: (e: FormEvent) => void;
  children: ReactNode;
}) {
  const t = useTranslations("Receivables");
  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-border bg-popover text-popover-foreground sm:max-w-lg">
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          {children}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Invoice                                                            */
/* ------------------------------------------------------------------ */

function sanitizeSearch(term: string): string {
  // Characters that are syntax inside a PostgREST or=() filter.
  return term.replace(/[%,()*\\"]/g, " ").trim();
}

export function InvoiceDialog({
  open,
  onOpenChange,
  snapshot,
  invoice,
  defaultCustomer,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: ReceivablesSnapshot;
  invoice?: InvoiceRow | null;
  defaultCustomer?: CustomerRow | null;
  onSaved: (invoiceId: string) => void;
}) {
  const t = useTranslations("Receivables");
  const { user, accountId } = useAuth();
  const editing = !!invoice;
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [customer, setCustomer] = useState<CustomerRow | null>(null);
  const [newCustomer, setNewCustomer] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<CustomerRow[]>([]);
  const [number, setNumber] = useState("");
  const [issueDate, setIssueDate] = useState(snapshot.today);
  const [dueDate, setDueDate] = useState(addDays(snapshot.today, 30));
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setSearch("");
    setResults([]);
    setNewCustomer(false);
    setNewName("");
    setNewPhone("");
    if (invoice) {
      setCustomer(snapshot.customers.get(invoice.contact_id) ?? null);
      setNumber(invoice.invoice_number);
      setIssueDate(invoice.issue_date);
      setDueDate(invoice.due_date);
      setAmount(paiseToDecimalString(invoice.total_paise));
      setNotes(invoice.notes ?? "");
    } else {
      setCustomer(defaultCustomer ?? null);
      setNumber("");
      setIssueDate(snapshot.today);
      setDueDate(addDays(snapshot.today, 30));
      setAmount("");
      setNotes("");
    }
  }, [open, invoice, defaultCustomer, snapshot]);

  useEffect(() => {
    const term = sanitizeSearch(search);
    if (!open || term.length < 2) return;
    const handle = setTimeout(async () => {
      const like = `%${term}%`;
      const { data } = await createClient()
        .from("contacts")
        .select(CUSTOMER_COLUMNS)
        .or(`name.ilike.${like},company.ilike.${like},phone.ilike.${like}`)
        .order("name")
        .limit(8);
      setResults((data ?? []) as CustomerRow[]);
    }, 250);
    return () => clearTimeout(handle);
  }, [search, open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    const trimmedNumber = number.trim();
    if (!trimmedNumber) next.number = t("validation.required");
    else if (trimmedNumber.length > 64) next.number = t("validation.tooLong", { max: 64 });
    if (!isIsoDate(issueDate)) next.issueDate = t("validation.date");
    if (!isIsoDate(dueDate)) next.dueDate = t("validation.date");
    else if (isIsoDate(issueDate) && dueDate < issueDate) next.dueDate = t("validation.dueBeforeIssue");
    const parsed = parseAmountToPaise(amount);
    if (!parsed.ok) next.amount = t(`validation.amount.${parsed.error}`);
    else if (invoice && parsed.paise < invoice.paid_paise + invoice.credited_paise) {
      next.amount = t("validation.belowReceived", {
        amount: formatPaise(invoice.paid_paise + invoice.credited_paise, invoice.currency),
      });
    }
    let phone: string | null = null;
    if (!editing) {
      if (newCustomer) {
        if (!newName.trim()) next.customer = t("validation.required");
        if (newPhone.trim()) {
          const p = normalizeIndianPhone(newPhone);
          if (!p.ok) next.newPhone = t("validation.phone");
          else phone = p.e164;
        }
      } else if (!customer) {
        next.customer = t("validation.pickCustomer");
      }
    }
    if (notes.length > 2000) next.notes = t("validation.tooLong", { max: 2000 });
    setErrors(next);
    if (Object.keys(next).length > 0 || !parsed.ok || !accountId || !user) return;

    setSaving(true);
    const supabase = createClient();
    try {
      if (editing && invoice) {
        const { error } = await supabase
          .from("invoices")
          .update({ invoice_number: trimmedNumber, issue_date: issueDate, due_date: dueDate, total_paise: parsed.paise, notes: notes.trim() || null })
          .eq("id", invoice.id);
        if (error) return handleError(error);
        toast.success(t("invoiceDialog.updated"));
        onSaved(invoice.id);
        onOpenChange(false);
        return;
      }

      let contactId = customer?.id ?? null;
      if (newCustomer) {
        const { data, error } = await supabase
          .from("contacts")
          .insert({ user_id: user.id, account_id: accountId, name: newName.trim(), phone: phone ?? "" })
          .select("id")
          .single();
        if (error?.code === "23505" && phone) {
          const { data: existing } = await supabase
            .from("contacts")
            .select("id")
            .eq("phone_normalized", phone.replace(/\D/g, ""))
            .maybeSingle();
          contactId = existing?.id ?? null;
          toast.info(t("invoiceDialog.usedExistingCustomer"));
        } else if (error || !data) {
          return handleError(error);
        } else {
          contactId = data.id;
        }
      }
      if (!contactId) return handleError(null);

      const { data, error } = await supabase
        .from("invoices")
        .insert({
          account_id: accountId,
          contact_id: contactId,
          invoice_number: trimmedNumber,
          issue_date: issueDate,
          due_date: dueDate,
          total_paise: parsed.paise,
          currency: snapshot.currency,
          notes: notes.trim() || null,
          source: "manual",
        })
        .select("id")
        .single();
      if (error || !data) return handleError(error);
      toast.success(t("invoiceDialog.created"));
      onSaved(data.id);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  function handleError(error: PgError) {
    if (error?.code === "23505") setErrors({ number: t("invoiceDialog.duplicateNumber") });
    else if (error?.message?.includes("invoices_not_overpaid")) setErrors({ amount: t("validation.belowReceived", { amount: "" }) });
    else toast.error(t("common.saveFailed"));
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? t("invoiceDialog.editTitle") : t("invoiceDialog.newTitle")}
      description={t("invoiceDialog.description")}
      submitLabel={editing ? t("common.save") : t("invoiceDialog.create")}
      saving={saving}
      onSubmit={submit}
    >
      {editing ? (
        <p className="text-sm text-muted-foreground">
          {t("invoiceDialog.customerFixed", { name: customerDisplayName(customer) })}
        </p>
      ) : (
        <div className="grid gap-2 rounded-lg border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{t("invoiceDialog.customer")}</span>
            <Button type="button" variant="ghost" size="sm" onClick={() => setNewCustomer((v) => !v)}>
              {newCustomer ? t("invoiceDialog.pickExisting") : t("invoiceDialog.addNewCustomer")}
            </Button>
          </div>
          {newCustomer ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="inv-new-name" label={t("fields.customerName")} error={errors.customer}>
                <Input id="inv-new-name" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={120} />
              </Field>
              <Field id="inv-new-phone" label={t("fields.phone")} hint={t("invoiceDialog.phoneHint")} error={errors.newPhone}>
                <Input id="inv-new-phone" inputMode="tel" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="98765 43210" />
              </Field>
            </div>
          ) : customer ? (
            <div className="flex items-center justify-between gap-2 rounded-md bg-muted px-3 py-2 text-sm">
              <span className="truncate">{customerDisplayName(customer)}</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => setCustomer(null)}>
                {t("common.change")}
              </Button>
            </div>
          ) : (
            <Field id="inv-customer-search" label={t("invoiceDialog.searchCustomer")} error={errors.customer}>
              <Input
                id="inv-customer-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("invoiceDialog.searchPlaceholder")}
                autoComplete="off"
              />
              {results.length > 0 && (
                <ul className="mt-1 max-h-48 overflow-y-auto rounded-md border border-border" role="listbox">
                  {results.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted focus:bg-muted focus:outline-none"
                        onClick={() => {
                          setCustomer(c);
                          setResults([]);
                        }}
                      >
                        <span className="truncate">{customerDisplayName(c)}</span>
                        <span className="shrink-0 font-mono text-xs text-muted-foreground">{c.phone}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Field>
          )}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="inv-number" label={t("fields.invoiceNumber")} error={errors.number}>
          <Input id="inv-number" value={number} onChange={(e) => setNumber(e.target.value)} maxLength={64} aria-invalid={!!errors.number} />
        </Field>
        <Field id="inv-amount" label={t("fields.invoiceAmount", { currency: snapshot.currency })} error={errors.amount}>
          <Input id="inv-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1,25,000" aria-invalid={!!errors.amount} />
        </Field>
        <Field id="inv-issue" label={t("fields.invoiceDate")} error={errors.issueDate}>
          <Input id="inv-issue" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
        </Field>
        <Field id="inv-due" label={t("fields.dueDate")} error={errors.dueDate}>
          <Input id="inv-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
      </div>
      <Field id="inv-notes" label={t("fields.notes")} error={errors.notes}>
        <Textarea id="inv-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} />
      </Field>
    </FormDialog>
  );
}

/* ------------------------------------------------------------------ */
/* Payment / credit note                                              */
/* ------------------------------------------------------------------ */

export function PaymentDialog({
  open,
  onOpenChange,
  snapshot,
  invoice,
  kind,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: ReceivablesSnapshot;
  invoice: InvoiceRow;
  kind: PaymentKind;
  onSaved: () => void;
}) {
  const t = useTranslations("Receivables");
  const { accountId } = useAuth();
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(snapshot.today);
  const [method, setMethod] = useState<PaymentMethod>("upi");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [clientRef, setClientRef] = useState(newClientRef);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset the form each time it opens */
    setErrors({});
    setAmount(paiseToDecimalString(invoice.outstanding_paise));
    setPaidOn(snapshot.today);
    setMethod("upi");
    setReference("");
    setNotes("");
    setClientRef(newClientRef());
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, invoice, snapshot.today]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    const parsed = parseAmountToPaise(amount);
    if (!parsed.ok) next.amount = t(`validation.amount.${parsed.error}`);
    else if (parsed.paise > invoice.outstanding_paise) {
      next.amount = t("validation.exceedsOutstanding", { amount: formatPaise(invoice.outstanding_paise, invoice.currency) });
    }
    if (!isIsoDate(paidOn)) next.paidOn = t("validation.date");
    else if (paidOn > snapshot.today) next.paidOn = t("validation.futureDate");
    setErrors(next);
    if (Object.keys(next).length > 0 || !parsed.ok || !accountId) return;

    setSaving(true);
    const { error } = await createClient().from("invoice_payments").insert({
      account_id: accountId,
      invoice_id: invoice.id,
      kind,
      amount_paise: parsed.paise,
      paid_on: paidOn,
      method: kind === "payment" ? method : "other",
      reference: reference.trim() || null,
      notes: notes.trim() || null,
      client_ref: clientRef,
    });
    setSaving(false);
    // 23505 on client_ref = this exact submission was already stored (retry / double tap).
    if (error && error.code !== "23505") {
      if (error.message?.includes("invoices_not_overpaid")) setErrors({ amount: t("validation.exceedsOutstandingNow") });
      else if (error.message?.includes("cancel")) toast.error(t("paymentDialog.cancelledInvoice"));
      else toast.error(t("common.saveFailed"));
      return;
    }
    toast.success(kind === "payment" ? t("paymentDialog.recorded") : t("paymentDialog.creditRecorded"));
    onSaved();
    onOpenChange(false);
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={kind === "payment" ? t("paymentDialog.title") : t("paymentDialog.creditTitle")}
      description={t("paymentDialog.description", {
        number: invoice.invoice_number,
        amount: formatPaise(invoice.outstanding_paise, invoice.currency),
      })}
      submitLabel={kind === "payment" ? t("paymentDialog.submit") : t("paymentDialog.creditSubmit")}
      saving={saving}
      onSubmit={submit}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="pay-amount" label={t("fields.amount", { currency: invoice.currency })} error={errors.amount}>
          <Input id="pay-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!!errors.amount} />
        </Field>
        <Field id="pay-date" label={kind === "payment" ? t("fields.paidOn") : t("fields.creditDate")} error={errors.paidOn}>
          <Input id="pay-date" type="date" value={paidOn} max={snapshot.today} onChange={(e) => setPaidOn(e.target.value)} />
        </Field>
        {kind === "payment" && (
          <Field id="pay-method" label={t("fields.method")}>
            <select id="pay-method" className={selectClassName} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {t(`paymentMethod.${m}`)}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field id="pay-ref" label={kind === "payment" ? t("fields.reference") : t("fields.creditNoteNumber")}>
          <Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} placeholder={kind === "payment" ? "UTR / cheque no." : ""} />
        </Field>
      </div>
      <Field id="pay-notes" label={t("fields.notes")}>
        <Textarea id="pay-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={1000} />
      </Field>
    </FormDialog>
  );
}

export function VoidPaymentDialog({
  open,
  onOpenChange,
  payment,
  currency,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: PaymentRow | null;
  currency: string;
  onSaved: () => void;
}) {
  const t = useTranslations("Receivables");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      /* eslint-disable react-hooks/set-state-in-effect -- reset on open */
      setReason("");
      setError(null);
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!payment) return;
    if (!reason.trim()) {
      setError(t("validation.required"));
      return;
    }
    setSaving(true);
    const { error: err } = await createClient()
      .from("invoice_payments")
      .update({ voided_at: new Date().toISOString(), void_reason: reason.trim().slice(0, 500) })
      .eq("id", payment.id)
      .is("voided_at", null);
    setSaving(false);
    if (err) {
      toast.error(t("common.saveFailed"));
      return;
    }
    toast.success(t("voidDialog.done"));
    onSaved();
    onOpenChange(false);
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("voidDialog.title")}
      description={payment ? t("voidDialog.description", { amount: formatPaise(payment.amount_paise, currency), date: payment.paid_on }) : undefined}
      submitLabel={t("voidDialog.submit")}
      saving={saving}
      onSubmit={submit}
    >
      <Field id="void-reason" label={t("fields.voidReason")} error={error}>
        <Input id="void-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder={t("voidDialog.placeholder")} />
      </Field>
    </FormDialog>
  );
}

/* ------------------------------------------------------------------ */
/* Follow-up                                                          */
/* ------------------------------------------------------------------ */

export function FollowUpDialog({
  open,
  onOpenChange,
  snapshot,
  contactId,
  defaultInvoiceId,
  defaultStatus = "follow_up_required",
  defaultChannel = "call",
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: ReceivablesSnapshot;
  contactId: string;
  defaultInvoiceId?: string | null;
  defaultStatus?: FollowUpStatus;
  defaultChannel?: FollowUpChannel;
  onSaved: () => void;
}) {
  const t = useTranslations("Receivables");
  const { accountId } = useAuth();
  const openInvoices = useMemo(
    () => snapshot.invoices.filter((i) => i.contact_id === contactId && i.status === "open" && i.outstanding_paise > 0),
    [snapshot.invoices, contactId],
  );
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [invoiceId, setInvoiceId] = useState<string>("");
  const [channel, setChannel] = useState<FollowUpChannel>(defaultChannel);
  const [status, setStatus] = useState<FollowUpStatus>(defaultStatus);
  const [summary, setSummary] = useState("");
  const [nextOn, setNextOn] = useState("");
  const [promiseDate, setPromiseDate] = useState("");
  const [promised, setPromised] = useState("");
  const [disputeReason, setDisputeReason] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [clientRef, setClientRef] = useState(newClientRef);

  const scopeOutstanding = invoiceId
    ? (openInvoices.find((i) => i.id === invoiceId)?.outstanding_paise ?? 0)
    : openInvoices.reduce((s, i) => s + i.outstanding_paise, 0);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset the form each time it opens */
    setErrors({});
    setInvoiceId(defaultInvoiceId ?? "");
    setChannel(defaultChannel);
    setStatus(defaultStatus);
    setSummary("");
    setNextOn("");
    setPromiseDate(addDays(snapshot.today, 3));
    setPromised("");
    setDisputeReason("");
    setInternalNotes("");
    setClientRef(newClientRef());
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, defaultInvoiceId, defaultChannel, defaultStatus, snapshot.today]);

  useEffect(() => {
    // Prefill the promised amount with what the chosen scope owes.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- derived default, user can edit
    if (status === "promise_to_pay" && !promised && scopeOutstanding > 0) setPromised(paiseToDecimalString(scopeOutstanding));
  }, [status, scopeOutstanding, promised]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    let promisedPaise: number | null = null;
    if (status === "promise_to_pay") {
      if (!isIsoDate(promiseDate)) next.promiseDate = t("validation.date");
      const parsed = parseAmountToPaise(promised);
      if (!parsed.ok) next.promised = t(`validation.amount.${parsed.error}`);
      else promisedPaise = parsed.paise;
    }
    if (status === "disputed" && !disputeReason.trim()) next.disputeReason = t("validation.required");
    if (nextOn && !isIsoDate(nextOn)) next.nextOn = t("validation.date");
    setErrors(next);
    if (Object.keys(next).length > 0 || !accountId) return;

    setSaving(true);
    const { error } = await createClient()
      .from("follow_ups")
      .insert({
        account_id: accountId,
        contact_id: contactId,
        invoice_id: invoiceId || null,
        channel,
        status,
        summary: summary.trim() || null,
        next_follow_up_on: nextOn || null,
        promise_date: status === "promise_to_pay" ? promiseDate : null,
        promised_paise: status === "promise_to_pay" ? promisedPaise : null,
        dispute_reason: status === "disputed" ? disputeReason.trim() : null,
        internal_notes: internalNotes.trim() || null,
        client_ref: clientRef,
      });
    setSaving(false);
    if (error && error.code !== "23505") {
      toast.error(t("common.saveFailed"));
      return;
    }
    toast.success(t("followUpDialog.saved"));
    onSaved();
    onOpenChange(false);
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("followUpDialog.title")}
      description={t("followUpDialog.description", { name: customerDisplayName(snapshot.customers.get(contactId)) })}
      submitLabel={t("followUpDialog.submit")}
      saving={saving}
      onSubmit={submit}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="fu-invoice" label={t("fields.regarding")}>
          <select id="fu-invoice" className={selectClassName} value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}>
            <option value="">{t("followUpDialog.allInvoices", { count: openInvoices.length })}</option>
            {openInvoices.map((i) => (
              <option key={i.id} value={i.id}>
                {i.invoice_number} — {formatPaise(i.outstanding_paise, i.currency)}
              </option>
            ))}
          </select>
        </Field>
        <Field id="fu-channel" label={t("fields.channel")}>
          <select id="fu-channel" className={selectClassName} value={channel} onChange={(e) => setChannel(e.target.value as FollowUpChannel)}>
            {FOLLOW_UP_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {t(`channel.${c}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field id="fu-status" label={t("fields.outcome")}>
          <select id="fu-status" className={selectClassName} value={status} onChange={(e) => setStatus(e.target.value as FollowUpStatus)}>
            {FOLLOW_UP_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`followUpStatus.${s}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field id="fu-next" label={t("fields.nextFollowUp")} error={errors.nextOn}>
          <Input id="fu-next" type="date" min={snapshot.today} value={nextOn} onChange={(e) => setNextOn(e.target.value)} />
        </Field>
      </div>
      {(status === "paid" || status === "partially_paid") && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
          {t("followUpDialog.paidNote")}
        </p>
      )}
      {status === "promise_to_pay" && (
        <div className="grid gap-3 rounded-lg border border-sky-500/30 p-3 sm:grid-cols-2">
          <Field id="fu-promise-date" label={t("fields.promiseDate")} error={errors.promiseDate}>
            <Input id="fu-promise-date" type="date" value={promiseDate} onChange={(e) => setPromiseDate(e.target.value)} />
          </Field>
          <Field id="fu-promised" label={t("fields.promisedAmount", { currency: snapshot.currency })} error={errors.promised}>
            <Input id="fu-promised" inputMode="decimal" value={promised} onChange={(e) => setPromised(e.target.value)} />
          </Field>
        </div>
      )}
      {status === "disputed" && (
        <Field id="fu-dispute" label={t("fields.disputeReason")} error={errors.disputeReason}>
          <Input id="fu-dispute" value={disputeReason} onChange={(e) => setDisputeReason(e.target.value)} maxLength={1000} placeholder={t("followUpDialog.disputePlaceholder")} />
        </Field>
      )}
      <Field id="fu-summary" label={t("fields.summary")}>
        <Textarea id="fu-summary" value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} maxLength={2000} placeholder={t("followUpDialog.summaryPlaceholder")} />
      </Field>
      <Field id="fu-notes" label={t("fields.internalNotes")} hint={t("followUpDialog.internalHint")}>
        <Textarea id="fu-notes" value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} rows={2} maxLength={2000} />
      </Field>
    </FormDialog>
  );
}
