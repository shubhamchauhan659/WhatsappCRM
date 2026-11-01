"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/receivables/dates";
import { formatPaise } from "@/lib/receivables/money";
import type { EvaluatedPromise } from "@/lib/receivables/promises";
import type { FollowUpRow, InvoiceRow, PaymentRow } from "@/lib/receivables/types";
import { FollowUpStatusBadge, PromiseStateBadge } from "./badges";

/**
 * The sent-message body is not part of the list snapshot (it is the
 * largest field); fetch it only when someone expands it.
 */
function MessageBody({ followUpId }: { followUpId: string }) {
  const t = useTranslations("Receivables");
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  async function load(open: boolean) {
    if (!open || text !== null) return;
    const { data, error } = await createClient().from("follow_ups").select("message").eq("id", followUpId).single();
    if (error || !data) setFailed(true);
    else setText((data as { message: string | null }).message ?? "");
  }
  return (
    <details className="text-xs text-muted-foreground" onToggle={(e) => void load((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer">{t("timeline.messageSent")}</summary>
      <p className="mt-1 whitespace-pre-wrap rounded bg-muted p-2 text-foreground">
        {failed ? t("common.loadFailed") : text === null ? t("common.loading") : text}
      </p>
    </details>
  );
}

/** Follow-up history list (newest first) used on invoice and customer pages. */
export function FollowUpTimeline({
  followUps,
  invoices,
  promises,
  timeZone,
  currency,
}: {
  followUps: FollowUpRow[];
  invoices: Map<string, InvoiceRow>;
  promises: Map<string, EvaluatedPromise>;
  timeZone: string;
  currency: string;
}) {
  const t = useTranslations("Receivables");
  if (followUps.length === 0) return <p className="px-4 py-6 text-sm text-muted-foreground">{t("timeline.empty")}</p>;
  return (
    <ol className="divide-y divide-border">
      {[...followUps]
        .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
        .map((f) => {
          const inv = f.invoice_id ? invoices.get(f.invoice_id) : undefined;
          const promise = promises.get(f.id);
          return (
            <li key={f.id} className="grid gap-1 px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <FollowUpStatusBadge status={f.status} />
                <span className="text-xs text-muted-foreground">
                  {formatDisplayDateTime(f.occurred_at, timeZone)} · {t(`channel.${f.channel}`)}
                  {inv ? (
                    <>
                      {" · "}
                      <Link href={`/receivables/invoices/${inv.id}`} className="hover:underline">
                        {inv.invoice_number}
                      </Link>
                    </>
                  ) : null}
                </span>
              </div>
              {f.summary && <p className="whitespace-pre-wrap">{f.summary}</p>}
              {f.status === "promise_to_pay" && f.promise_date && f.promised_paise && (
                <p className="flex flex-wrap items-center gap-2 text-xs">
                  {t("timeline.promise", { amount: formatPaise(f.promised_paise, currency), date: formatDisplayDate(f.promise_date) })}
                  {promise && <PromiseStateBadge state={promise.state} />}
                </p>
              )}
              {f.dispute_reason && <p className="text-xs text-red-700 dark:text-red-300">{t("timeline.dispute", { reason: f.dispute_reason })}</p>}
              {f.next_follow_up_on && <p className="text-xs text-muted-foreground">{t("timeline.next", { date: formatDisplayDate(f.next_follow_up_on) })}</p>}
              {f.has_message && <MessageBody followUpId={f.id} />}
              {f.internal_notes && <p className="text-xs italic text-muted-foreground">{t("timeline.internal", { notes: f.internal_notes })}</p>}
            </li>
          );
        })}
    </ol>
  );
}

/** Payment history with optional void action. */
export function PaymentList({
  payments,
  invoices,
  currency,
  canVoid,
  onVoid,
}: {
  payments: PaymentRow[];
  invoices?: Map<string, InvoiceRow>;
  currency: string;
  canVoid: boolean;
  onVoid?: (p: PaymentRow) => void;
}) {
  const t = useTranslations("Receivables");
  if (payments.length === 0) return <p className="px-4 py-6 text-sm text-muted-foreground">{t("payments.empty")}</p>;
  return (
    <ul className="divide-y divide-border">
      {[...payments]
        .sort((a, b) => b.paid_on.localeCompare(a.paid_on) || b.created_at.localeCompare(a.created_at))
        .map((p) => {
          const inv = invoices?.get(p.invoice_id);
          return (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
              <div className="min-w-0">
                <p className={p.voided_at ? "text-muted-foreground line-through" : "font-medium"}>
                  {formatPaise(p.amount_paise, currency)} · {p.kind === "credit_note" ? t("payments.creditNote") : t(`paymentMethod.${p.method}`)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDisplayDate(p.paid_on)}
                  {inv ? ` · ${inv.invoice_number}` : ""}
                  {p.reference ? ` · ${p.reference}` : ""}
                </p>
                {p.voided_at && <p className="text-xs text-red-700 dark:text-red-300">{t("payments.voided", { reason: p.void_reason ?? "" })}</p>}
              </div>
              {!p.voided_at && canVoid && onVoid && (
                <Button size="sm" variant="ghost" onClick={() => onVoid(p)}>
                  {t("payments.void")}
                </Button>
              )}
            </li>
          );
        })}
    </ul>
  );
}
