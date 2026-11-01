"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDisplayDate } from "@/lib/receivables/dates";
import { formatPaise } from "@/lib/receivables/money";
import type { QueueReason } from "@/lib/receivables/queue";
import { customerDisplayName, type CustomerRow } from "@/lib/receivables/types";
import { cn } from "@/lib/utils";

export function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "danger" | "warn" }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 sm:p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-lg font-semibold tabular-nums sm:text-2xl",
          tone === "danger" && "text-red-600 dark:text-red-400",
          tone === "warn" && "text-amber-700 dark:text-amber-300",
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Section({ title, action, children, className }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={cn("gap-0 py-0", className)}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 border-b border-border px-4 py-3">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        {action}
      </CardHeader>
      <CardContent className="px-0 py-0">{children}</CardContent>
    </Card>
  );
}

export function CustomerLink({ customer, contactId }: { customer: CustomerRow | undefined; contactId: string }) {
  return (
    <Link href={`/receivables/customers/${contactId}`} className="font-medium text-foreground hover:underline">
      {customerDisplayName(customer)}
    </Link>
  );
}

/** Human-readable, translated "why is this customer in today's list". */
export function ReasonChips({ reasons, currency }: { reasons: QueueReason[]; currency: string }) {
  const t = useTranslations("Receivables");
  const label = (r: QueueReason): string => {
    switch (r.code) {
      case "overdue_days":
        return t("reasons.overdue_days", { days: r.days });
      case "overdue_amount":
        return t("reasons.overdue_amount", { amount: formatPaise(r.paise, currency), count: r.invoices });
      case "missed_promises":
        return t("reasons.missed_promises", { count: r.count });
      case "promise_due_today":
        return t("reasons.promise_due_today", { amount: formatPaise(r.paise, currency) });
      case "promise_missed":
        return t("reasons.promise_missed", { amount: formatPaise(r.paise, currency), date: formatDisplayDate(r.date) });
      case "follow_up_due":
        return t("reasons.follow_up_due", { date: formatDisplayDate(r.date) });
      case "never_contacted":
        return t("reasons.never_contacted");
      case "recently_contacted":
        return t("reasons.recently_contacted", { days: r.days });
      case "disputed":
        return r.reason ? t("reasons.disputed_with_reason", { reason: r.reason }) : t("reasons.disputed");
    }
  };
  const danger = new Set(["promise_missed", "missed_promises", "promise_due_today"]);
  return (
    <ul className="flex flex-wrap gap-1" aria-label={t("queue.whyLabel")}>
      {reasons.map((r, i) => (
        <li
          key={`${r.code}-${i}`}
          className={cn(
            "rounded-full border px-2 py-0.5 text-[11px]",
            danger.has(r.code)
              ? "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300"
              : r.code === "recently_contacted"
                ? "border-border bg-card text-muted-foreground"
                : "border-border bg-muted text-foreground",
          )}
        >
          {label(r)}
        </li>
      ))}
    </ul>
  );
}
