"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps, ReactNode } from "react";
import type { VariantProps } from "class-variance-authority";
import { useTranslations } from "next-intl";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ButtonLook = VariantProps<typeof buttonVariants>;

/** A real link (correct semantics for navigation) styled as a button. */
export function LinkButton({ variant, size, className, ...props }: ComponentProps<typeof Link> & ButtonLook) {
  return <Link className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

/** External / protocol link (tel:, wa.me) styled as a button. */
export function AnchorButton({ variant, size, className, ...props }: ComponentProps<"a"> & ButtonLook) {
  return <a className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

const TABS = [
  { href: "/receivables", key: "overview" },
  { href: "/receivables/queue", key: "queue" },
  { href: "/receivables/invoices", key: "invoices" },
  { href: "/receivables/customers", key: "customers" },
  { href: "/receivables/follow-ups", key: "followUps" },
  { href: "/receivables/import", key: "import" },
  { href: "/receivables/reports", key: "reports" },
] as const;

/** Page frame for every receivables screen: title, actions, sub-navigation. */
export function ReceivablesShell({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const t = useTranslations("Receivables");
  const pathname = usePathname();
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <nav aria-label={t("nav.label")} className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex min-w-max gap-1 border-b border-border">
          {TABS.map((tab) => {
            const active = tab.href === "/receivables" ? pathname === tab.href : pathname.startsWith(tab.href);
            return (
              <li key={tab.href}>
                <Link
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex h-10 items-center border-b-2 px-3 text-sm font-medium transition-colors",
                    active
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t(`nav.${tab.key}`)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

/** Loading / error frame shared by receivables pages. */
export function SnapshotStatus({
  status,
  error,
  onRetry,
}: {
  status: "loading" | "ready" | "error";
  error: string | null;
  onRetry: () => void;
}) {
  const t = useTranslations("Receivables");
  if (status === "loading") {
    return (
      <div role="status" className="flex items-center justify-center gap-2 rounded-lg border border-border p-10 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {t("common.loading")}
      </div>
    );
  }
  if (status === "error") {
    return (
      <div role="alert" className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-destructive/40 p-8 text-center">
        <AlertTriangle className="size-6 text-destructive" />
        <p className="text-sm text-foreground">{t("common.loadFailed")}</p>
        {error && <p className="max-w-md text-xs text-muted-foreground">{error}</p>}
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="size-3.5" />
          {t("common.retry")}
        </Button>
      </div>
    );
  }
  return null;
}

/** Simple, consistent empty state. */
export function EmptyPanel({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-card/40 px-4 py-10 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {hint && <p className="max-w-md text-xs text-muted-foreground">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Prev / next pager for client-side lists. */
export function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const t = useTranslations("Receivables");
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>
        {t("common.showing", {
          start: page * pageSize + 1,
          end: Math.min((page + 1) * pageSize, total),
          total,
        })}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" disabled={page === 0} onClick={() => onPage(page - 1)}>
          {t("common.previous")}
        </Button>
        <span className="px-2">{t("common.pageOf", { page: page + 1, pages })}</span>
        <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>
          {t("common.next")}
        </Button>
      </div>
    </div>
  );
}

export const selectClassName =
  "h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60";
