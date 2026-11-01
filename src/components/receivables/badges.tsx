"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { PromiseState } from "@/lib/receivables/promises";
import type { InvoiceBadge } from "@/lib/receivables/status";
import type { FollowUpStatus } from "@/lib/receivables/types";

const pill = "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap";

const STATE_CLASS: Record<InvoiceBadge["state"], string> = {
  paid: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  partially_paid: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  unpaid: "border-border bg-muted text-foreground",
  cancelled: "border-border bg-card text-muted-foreground line-through",
};

/** Payment state plus an explicit overdue marker (colour is never the only signal). */
export function InvoiceStateBadge({ badge }: { badge: InvoiceBadge }) {
  const t = useTranslations("Receivables");
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className={cn(pill, STATE_CLASS[badge.state])}>{t(`invoiceState.${badge.state}`)}</span>
      {badge.overdueDays > 0 && (
        <span
          className={cn(
            pill,
            badge.overdueDays > 30
              ? "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300"
              : "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
          )}
        >
          {t("invoiceState.overdueDays", { days: badge.overdueDays })}
        </span>
      )}
    </span>
  );
}

const FOLLOW_UP_CLASS: Partial<Record<FollowUpStatus, string>> = {
  promise_to_pay: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  disputed: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
  paid: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  partially_paid: "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300",
  reminder_sent: "border-primary/40 bg-primary/10 text-primary",
};

export function FollowUpStatusBadge({ status }: { status: FollowUpStatus }) {
  const t = useTranslations("Receivables");
  return (
    <span className={cn(pill, FOLLOW_UP_CLASS[status] ?? "border-border bg-muted text-foreground")}>
      {t(`followUpStatus.${status}`)}
    </span>
  );
}

const PROMISE_CLASS: Record<PromiseState, string> = {
  settled: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  kept: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  pending: "border-border bg-muted text-foreground",
  due_today: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  missed: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
};

export function PromiseStateBadge({ state }: { state: PromiseState }) {
  const t = useTranslations("Receivables");
  return <span className={cn(pill, PROMISE_CLASS[state])}>{t(`promiseState.${state}`)}</span>;
}
