'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { FileUp, ListChecks, Plus, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GatedButton } from '@/components/ui/gated-button';
import { useCan } from '@/hooks/use-can';
import { InvoiceDialog } from '@/components/receivables/dialogs';
import { FollowUpStatusBadge, PromiseStateBadge } from '@/components/receivables/badges';
import { CustomerLink, Kpi, Section } from '@/components/receivables/bits';
import { EmptyPanel, LinkButton, ReceivablesShell, SnapshotStatus } from '@/components/receivables/shell';
import { useReceivables } from '@/components/receivables/use-receivables';
import { formatDisplayDate, formatDisplayDateTime } from '@/lib/receivables/dates';
import { formatPaise } from '@/lib/receivables/money';
import { buildOverview } from '@/lib/receivables/overview';
import { buildFollowUpQueue } from '@/lib/receivables/queue';
import { daysOverdue } from '@/lib/receivables/status';

export default function ReceivablesOverviewPage() {
  const t = useTranslations('Receivables');
  const canEdit = useCan('send-messages');
  const state = useReceivables();
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const data = state.data;

  const overview = useMemo(
    () =>
      data &&
      buildOverview({
        invoices: data.invoices,
        payments: data.payments,
        followUps: data.followUps,
        today: data.today,
        timeZone: data.timeZone,
        currency: data.currency,
      }),
    [data],
  );
  const queueCount = useMemo(
    () =>
      data
        ? buildFollowUpQueue({
            invoices: data.invoices,
            payments: data.payments,
            followUps: data.followUps,
            customers: [...data.customers.values()],
            today: data.today,
            timeZone: data.timeZone,
            currency: data.currency,
          }).items.length
        : 0,
    [data],
  );

  const money = (p: number) => formatPaise(p, data?.currency ?? 'INR');
  const invoiceById = useMemo(() => new Map((data?.invoices ?? []).map((i) => [i.id, i])), [data]);

  return (
    <ReceivablesShell
      title={t('overview.title')}
      description={data ? t('overview.subtitle', { date: formatDisplayDate(data.today) }) : undefined}
      actions={
        <>
          <LinkButton href="/receivables/queue" variant="outline">
            <ListChecks className="size-4" />
            {t('overview.openQueue', { count: queueCount })}
          </LinkButton>
          <GatedButton canAct={canEdit} gateReason={t('common.gateRecord')} onClick={() => setInvoiceOpen(true)} disabled={!data}>
            <Plus className="size-4" />
            {t('common.addInvoice')}
          </GatedButton>
        </>
      }
    >
      {!data && <SnapshotStatus status={state.status} error={state.error} onRetry={state.reload} />}
      {state.status === 'error' && data && <SnapshotStatus status="error" error={state.error} onRetry={state.reload} />}

      {data && overview && data.invoices.length === 0 && (
        <EmptyPanel
          title={t('overview.emptyTitle')}
          hint={t('overview.emptyHint')}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <LinkButton href="/receivables/import">
                <FileUp className="size-4" />
                {t('overview.importCsv')}
              </LinkButton>
              <Button variant="outline" onClick={() => setInvoiceOpen(true)} disabled={!canEdit}>
                <Plus className="size-4" />
                {t('common.addInvoice')}
              </Button>
              <LinkButton variant="ghost" href="/settings?tab=business">
                <Settings2 className="size-4" />
                {t('overview.businessProfile')}
              </LinkButton>
            </div>
          }
        />
      )}

      {data && overview && data.invoices.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-5">
            <Kpi label={t('overview.kpi.outstanding')} value={money(overview.outstandingPaise)} hint={t('overview.kpi.openInvoices', { count: overview.openInvoiceCount })} />
            <Kpi label={t('overview.kpi.overdue')} value={money(overview.overduePaise)} hint={t('overview.kpi.overdueInvoices', { count: overview.overdueInvoiceCount })} tone={overview.overduePaise > 0 ? 'danger' : undefined} />
            <Kpi label={t('aging.d1_7')} value={money(overview.aging.d1_7)} tone={overview.aging.d1_7 > 0 ? 'warn' : undefined} />
            <Kpi label={t('aging.d8_30')} value={money(overview.aging.d8_30)} tone={overview.aging.d8_30 > 0 ? 'warn' : undefined} />
            <Kpi label={t('aging.d31_plus')} value={money(overview.aging.d31_plus)} tone={overview.aging.d31_plus > 0 ? 'danger' : undefined} />
          </div>
          {overview.otherCurrencyInvoiceCount > 0 && (
            <p className="text-xs text-muted-foreground">{t('overview.otherCurrency', { count: overview.otherCurrencyInvoiceCount, currency: data.currency })}</p>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title={t('overview.promisesTitle')}>
              {overview.promisesDueOrMissed.length === 0 ? (
                <p className="px-4 py-6 text-sm text-muted-foreground">{t('overview.promisesEmpty')}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {overview.promisesDueOrMissed.slice(0, 8).map((p) => (
                    <li key={p.followUp.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                      <div className="min-w-0">
                        <CustomerLink customer={data.customers.get(p.followUp.contact_id)} contactId={p.followUp.contact_id} />
                        <p className="text-xs text-muted-foreground">
                          {t('overview.promiseLine', { amount: money(p.promisedPaise), date: formatDisplayDate(p.followUp.promise_date as string) })}
                        </p>
                      </div>
                      <PromiseStateBadge state={p.state} />
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title={t('overview.dueTodayTitle')}>
              {overview.followUpsDueToday.length === 0 ? (
                <p className="px-4 py-6 text-sm text-muted-foreground">{t('overview.dueTodayEmpty')}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {overview.followUpsDueToday.slice(0, 8).map((f) => (
                    <li key={f.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                      <CustomerLink customer={data.customers.get(f.contact_id)} contactId={f.contact_id} />
                      <span className="text-xs text-muted-foreground">{formatDisplayDate(f.next_follow_up_on as string)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title={t('overview.topCustomersTitle')} action={<Link href="/receivables/customers" className="text-xs text-primary hover:underline">{t('common.viewAll')}</Link>}>
              {overview.topOverdueCustomers.length === 0 ? (
                <p className="px-4 py-6 text-sm text-muted-foreground">{t('overview.nothingOverdue')}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {overview.topOverdueCustomers.map((c) => (
                    <li key={c.contactId} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                      <div className="min-w-0">
                        <CustomerLink customer={data.customers.get(c.contactId)} contactId={c.contactId} />
                        <p className="text-xs text-muted-foreground">{t('overview.customerLine', { count: c.overdueInvoices, days: c.maxDaysOverdue })}</p>
                      </div>
                      <span className="font-semibold tabular-nums text-red-600 dark:text-red-400">{money(c.overduePaise)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title={t('overview.noFollowUpTitle')}>
              {overview.overdueWithoutFollowUp.length === 0 ? (
                <p className="px-4 py-6 text-sm text-muted-foreground">{t('overview.noFollowUpEmpty')}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {overview.overdueWithoutFollowUp.slice(0, 8).map((inv) => (
                    <li key={inv.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                      <div className="min-w-0">
                        <Link href={`/receivables/invoices/${inv.id}`} className="font-medium hover:underline">
                          {inv.invoice_number}
                        </Link>
                        <p className="truncate text-xs text-muted-foreground">
                          <CustomerLink customer={data.customers.get(inv.contact_id)} contactId={inv.contact_id} /> ·{' '}
                          {t('invoiceState.overdueDays', { days: daysOverdue(inv, data.today) })}
                        </p>
                      </div>
                      <span className="tabular-nums">{money(inv.outstanding_paise)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title={t('overview.recentPaymentsTitle')}>
              {overview.recentPayments.length === 0 ? (
                <p className="px-4 py-6 text-sm text-muted-foreground">{t('overview.recentPaymentsEmpty')}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {overview.recentPayments.map((p) => {
                    const inv = invoiceById.get(p.invoice_id);
                    return (
                      <li key={p.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                        <div className="min-w-0">
                          {inv ? (
                            <Link href={`/receivables/invoices/${inv.id}`} className="font-medium hover:underline">
                              {inv.invoice_number}
                            </Link>
                          ) : null}
                          <p className="text-xs text-muted-foreground">
                            {formatDisplayDate(p.paid_on)} · {p.kind === 'credit_note' ? t('payments.creditNote') : t(`paymentMethod.${p.method}`)}
                          </p>
                        </div>
                        <span className="tabular-nums text-emerald-700 dark:text-emerald-300">{money(p.amount_paise)}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Section>

            <Section title={t('overview.recentActivityTitle')} action={<Link href="/receivables/follow-ups" className="text-xs text-primary hover:underline">{t('common.viewAll')}</Link>}>
              {overview.recentFollowUps.length === 0 ? (
                <p className="px-4 py-6 text-sm text-muted-foreground">{t('overview.recentActivityEmpty')}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {overview.recentFollowUps.map((f) => (
                    <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                      <div className="min-w-0">
                        <CustomerLink customer={data.customers.get(f.contact_id)} contactId={f.contact_id} />
                        <p className="text-xs text-muted-foreground">
                          {formatDisplayDateTime(f.occurred_at, data.timeZone)} · {t(`channel.${f.channel}`)}
                        </p>
                      </div>
                      <FollowUpStatusBadge status={f.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </>
      )}

      {data && (
        <InvoiceDialog open={invoiceOpen} onOpenChange={setInvoiceOpen} snapshot={data} onSaved={() => void state.reload()} />
      )}
    </ReceivablesShell>
  );
}
