'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Section } from '@/components/receivables/bits';
import { EmptyPanel, Pager, ReceivablesShell, SnapshotStatus, selectClassName } from '@/components/receivables/shell';
import { FollowUpTimeline } from '@/components/receivables/timeline';
import { useReceivables } from '@/components/receivables/use-receivables';
import { evaluatePromises } from '@/lib/receivables/promises';
import { FOLLOW_UP_CHANNELS, FOLLOW_UP_STATUSES, customerDisplayName } from '@/lib/receivables/types';
import Link from 'next/link';

const PAGE_SIZE = 30;

export default function FollowUpHistoryPage() {
  const t = useTranslations('Receivables');
  const state = useReceivables();
  const data = state.data;
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [channel, setChannel] = useState('');
  const [page, setPage] = useState(0);

  const derived = useMemo(() => {
    if (!data) return null;
    const promises = evaluatePromises({ followUps: data.followUps, invoices: data.invoices, payments: data.payments, today: data.today, timeZone: data.timeZone });
    return {
      promiseById: new Map(promises.map((p) => [p.followUp.id, p])),
      invoiceMap: new Map(data.invoices.map((i) => [i.id, i])),
    };
  }, [data]);

  const rows = useMemo(() => {
    if (!data) return [];
    const term = search.trim().toLowerCase();
    return data.followUps
      .filter((f) => (!status || f.status === status) && (!channel || f.channel === channel))
      .filter((f) => !term || customerDisplayName(data.customers.get(f.contact_id)).toLowerCase().includes(term) || (f.summary ?? '').toLowerCase().includes(term))
      .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  }, [data, search, status, channel]);

  const visible = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const byCustomer = useMemo(() => {
    const groups: { contactId: string; items: typeof visible }[] = [];
    for (const f of visible) {
      const last = groups.at(-1);
      if (last && last.contactId === f.contact_id) last.items.push(f);
      else groups.push({ contactId: f.contact_id, items: [f] });
    }
    return groups;
  }, [visible]);

  return (
    <ReceivablesShell title={t('history.title')} description={t('history.subtitle', { count: rows.length })}>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label={t('history.searchLabel')} placeholder={t('history.searchPlaceholder')} value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} className="pl-8" />
        </div>
        <select aria-label={t('fields.outcome')} className={`${selectClassName} sm:w-48`} value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}>
          <option value="">{t('history.allStatuses')}</option>
          {FOLLOW_UP_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`followUpStatus.${s}`)}
            </option>
          ))}
        </select>
        <select aria-label={t('fields.channel')} className={`${selectClassName} sm:w-40`} value={channel} onChange={(e) => { setChannel(e.target.value); setPage(0); }}>
          <option value="">{t('history.allChannels')}</option>
          {FOLLOW_UP_CHANNELS.map((c) => (
            <option key={c} value={c}>
              {t(`channel.${c}`)}
            </option>
          ))}
        </select>
      </div>
      {!data && <SnapshotStatus status={state.status} error={state.error} onRetry={state.reload} />}
      {data && rows.length === 0 && <EmptyPanel title={data.followUps.length === 0 ? t('history.emptyTitle') : t('history.noMatch')} hint={data.followUps.length === 0 ? t('history.emptyHint') : undefined} />}
      {data && derived && byCustomer.map((g, i) => (
        <Section
          key={`${g.contactId}-${i}`}
          title={customerDisplayName(data.customers.get(g.contactId))}
          action={<Link href={`/receivables/customers/${g.contactId}`} className="text-xs text-primary hover:underline">{t('history.openCustomer')}</Link>}
        >
          <FollowUpTimeline followUps={g.items} invoices={derived.invoiceMap} promises={derived.promiseById} timeZone={data.timeZone} currency={data.currency} />
        </Section>
      ))}
      <Pager page={page} pageSize={PAGE_SIZE} total={rows.length} onPage={setPage} />
    </ReceivablesShell>
  );
}
