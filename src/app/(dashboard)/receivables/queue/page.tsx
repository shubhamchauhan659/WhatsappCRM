'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { MessageSquareText, Phone, PhoneCall } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCan } from '@/hooks/use-can';
import { FollowUpDialog } from '@/components/receivables/dialogs';
import { ReminderComposer } from '@/components/receivables/reminder-composer';
import { CustomerLink, ReasonChips, Section } from '@/components/receivables/bits';
import { AnchorButton, EmptyPanel, ReceivablesShell, SnapshotStatus } from '@/components/receivables/shell';
import { useReceivables } from '@/components/receivables/use-receivables';
import { dateInTimeZone, formatDisplayDate } from '@/lib/receivables/dates';
import { formatPaise } from '@/lib/receivables/money';
import { telLink } from '@/lib/receivables/phone';
import { buildFollowUpQueue, type QueueItem } from '@/lib/receivables/queue';

export default function FollowUpQueuePage() {
  const t = useTranslations('Receivables');
  const canEdit = useCan('send-messages');
  const state = useReceivables();
  const data = state.data;
  const [reminderFor, setReminderFor] = useState<QueueItem | null>(null);
  const [logFor, setLogFor] = useState<QueueItem | null>(null);

  const queue = useMemo(
    () =>
      data &&
      buildFollowUpQueue({
        invoices: data.invoices,
        payments: data.payments,
        followUps: data.followUps,
        customers: [...data.customers.values()],
        today: data.today,
        timeZone: data.timeZone,
        currency: data.currency,
      }),
    [data],
  );
  const money = (p: number) => formatPaise(p, data?.currency ?? 'INR');

  const renderItem = (item: QueueItem, rank?: number) => {
    const tel = telLink(item.customer?.phone);
    return (
      <li key={item.contactId} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2">
            {rank !== undefined && <span className="text-xs font-semibold text-muted-foreground">#{rank}</span>}
            <CustomerLink customer={item.customer} contactId={item.contactId} />
            <span className="text-sm font-semibold tabular-nums text-red-600 dark:text-red-400">
              {item.overduePaise > 0 ? money(item.overduePaise) : money(item.outstandingPaise)}
            </span>
          </div>
          <div className="mt-1.5">
            <ReasonChips reasons={item.reasons} currency={data?.currency ?? 'INR'} />
          </div>
          {item.lastFollowUp && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t('queue.lastContact', {
                date: formatDisplayDate(dateInTimeZone(item.lastFollowUp.occurred_at, data?.timeZone ?? 'Asia/Kolkata')),
                status: t(`followUpStatus.${item.lastFollowUp.status}`),
              })}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={!canEdit} onClick={() => setReminderFor(item)}>
            <MessageSquareText className="size-3.5" />
            {t('queue.remind')}
          </Button>
          <Button size="sm" variant="outline" disabled={!canEdit} onClick={() => setLogFor(item)}>
            <PhoneCall className="size-3.5" />
            {t('queue.logOutcome')}
          </Button>
          {tel && (
            <AnchorButton size="sm" variant="ghost" href={tel} aria-label={t('queue.callAria')}>
              <Phone className="size-3.5" />
              {t('queue.call')}
            </AnchorButton>
          )}
        </div>
      </li>
    );
  };

  return (
    <ReceivablesShell
      title={t('queue.title')}
      description={data ? t('queue.subtitle', { date: formatDisplayDate(data.today), count: queue?.items.length ?? 0 }) : undefined}
    >
      {!data && <SnapshotStatus status={state.status} error={state.error} onRetry={state.reload} />}
      {data && queue && (
        <>
          {queue.items.length === 0 ? (
            <EmptyPanel title={t('queue.emptyTitle')} hint={t('queue.emptyHint')} />
          ) : (
            <Section title={t('queue.todayList')}>
              <ol className="divide-y divide-border">{queue.items.map((item, i) => renderItem(item, i + 1))}</ol>
            </Section>
          )}
          {queue.disputed.length > 0 && (
            <Section title={t('queue.disputedTitle')}>
              <p className="px-4 pt-3 text-xs text-muted-foreground">{t('queue.disputedHint')}</p>
              <ul className="divide-y divide-border">{queue.disputed.map((item) => renderItem(item))}</ul>
            </Section>
          )}
          {queue.snoozed.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t('queue.snoozed', { count: queue.snoozed.length, date: formatDisplayDate(queue.snoozed[0].until) })}
            </p>
          )}
          <details className="rounded-lg border border-border p-3 text-xs text-muted-foreground">
            <summary className="cursor-pointer font-medium text-foreground">{t('queue.howTitle')}</summary>
            <p className="mt-2 whitespace-pre-line">{t('queue.howBody')}</p>
          </details>
        </>
      )}
      {data && reminderFor && (
        <ReminderComposer
          open={!!reminderFor}
          onOpenChange={(o) => !o && setReminderFor(null)}
          snapshot={data}
          contactId={reminderFor.contactId}
          preselectInvoiceIds={reminderFor.overdueInvoiceIds}
          onRecorded={() => void state.reload()}
        />
      )}
      {data && logFor && (
        <FollowUpDialog
          open={!!logFor}
          onOpenChange={(o) => !o && setLogFor(null)}
          snapshot={data}
          contactId={logFor.contactId}
          defaultChannel="call"
          defaultStatus="customer_replied"
          onSaved={() => void state.reload()}
        />
      )}
    </ReceivablesShell>
  );
}
