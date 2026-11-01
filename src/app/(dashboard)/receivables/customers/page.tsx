'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyPanel, Pager, ReceivablesShell, SnapshotStatus, selectClassName } from '@/components/receivables/shell';
import { useReceivables } from '@/components/receivables/use-receivables';
import { formatDisplayDate } from '@/lib/receivables/dates';
import { formatPaise } from '@/lib/receivables/money';
import { customerBalances } from '@/lib/receivables/overview';
import { customerDisplayName } from '@/lib/receivables/types';

const PAGE_SIZE = 25;
const FILTERS = ['overdue', 'outstanding', 'all'] as const;
type Filter = (typeof FILTERS)[number];
const SORTS = ['overdue', 'outstanding', 'name'] as const;
type Sort = (typeof SORTS)[number];

export default function CustomersPage() {
  const t = useTranslations('Receivables');
  const state = useReceivables();
  const data = state.data;
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('outstanding');
  const [sort, setSort] = useState<Sort>('overdue');
  const [page, setPage] = useState(0);

  const rows = useMemo(() => {
    if (!data) return [];
    const balances = customerBalances(data.invoices, data.payments, data.followUps, data.today, data.currency);
    const term = search.trim().toLowerCase();
    const ids = new Set([...data.customers.keys()]);
    return [...ids]
      .map((id) => ({
        id,
        customer: data.customers.get(id),
        balance: balances.get(id),
      }))
      .filter((r) => {
        if (filter === 'overdue') return (r.balance?.overduePaise ?? 0) > 0;
        if (filter === 'outstanding') return (r.balance?.outstandingPaise ?? 0) > 0;
        return true;
      })
      .filter((r) => {
        if (!term) return true;
        const c = r.customer;
        return customerDisplayName(c).toLowerCase().includes(term) || (c?.phone ?? '').includes(term) || (c?.email ?? '').toLowerCase().includes(term);
      })
      .sort((a, b) => {
        if (sort === 'name') return customerDisplayName(a.customer).localeCompare(customerDisplayName(b.customer));
        const key = sort === 'overdue' ? 'overduePaise' : 'outstandingPaise';
        return (b.balance?.[key] ?? 0) - (a.balance?.[key] ?? 0);
      });
  }, [data, search, filter, sort]);

  const visible = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const money = (p: number) => formatPaise(p, data?.currency ?? 'INR');

  return (
    <ReceivablesShell
      title={t('customers.title')}
      description={t('customers.subtitle')}
      actions={
        <Link href="/contacts" className="text-sm text-primary hover:underline">
          {t('customers.manageContacts')}
        </Link>
      }
    >
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label={t('customers.searchLabel')}
            placeholder={t('customers.searchPlaceholder')}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            className="pl-8"
          />
        </div>
        <select aria-label={t('customers.filterLabel')} className={`${selectClassName} sm:w-44`} value={filter} onChange={(e) => { setFilter(e.target.value as Filter); setPage(0); }}>
          {FILTERS.map((f) => (
            <option key={f} value={f}>
              {t(`customers.filters.${f}`)}
            </option>
          ))}
        </select>
        <select aria-label={t('customers.sortLabel')} className={`${selectClassName} sm:w-44`} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          {SORTS.map((s) => (
            <option key={s} value={s}>
              {t(`customers.sorts.${s}`)}
            </option>
          ))}
        </select>
      </div>

      {!data && <SnapshotStatus status={state.status} error={state.error} onRetry={state.reload} />}
      {data && rows.length === 0 && <EmptyPanel title={data.customers.size === 0 ? t('customers.emptyTitle') : t('customers.noMatch')} hint={data.customers.size === 0 ? t('customers.emptyHint') : undefined} />}
      {data && rows.length > 0 && (
        <>
          <ul className="grid gap-2 md:hidden">
            {visible.map((r) => (
              <li key={r.id}>
                <Link href={`/receivables/customers/${r.id}`} className="block rounded-lg border border-border p-3 hover:bg-muted/50">
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 truncate font-medium">{customerDisplayName(r.customer)}</span>
                    <span className="font-semibold tabular-nums">{money(r.balance?.outstandingPaise ?? 0)}</span>
                  </div>
                  <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                    <span>{r.customer?.phone || '—'}</span>
                    {(r.balance?.overduePaise ?? 0) > 0 && (
                      <span className="text-red-600 dark:text-red-400">{t('customers.overdueAmount', { amount: money(r.balance?.overduePaise ?? 0) })}</span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('fields.customer')}</TableHead>
                  <TableHead>{t('fields.phone')}</TableHead>
                  <TableHead className="text-right">{t('fields.outstanding')}</TableHead>
                  <TableHead className="text-right">{t('fields.overdue')}</TableHead>
                  <TableHead>{t('fields.lastPayment')}</TableHead>
                  <TableHead>{t('fields.nextFollowUp')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="max-w-64 truncate">
                      <Link href={`/receivables/customers/${r.id}`} className="font-medium hover:underline">
                        {customerDisplayName(r.customer)}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.customer?.phone || '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(r.balance?.outstandingPaise ?? 0)}</TableCell>
                    <TableCell className="text-right tabular-nums text-red-600 dark:text-red-400">
                      {(r.balance?.overduePaise ?? 0) > 0 ? money(r.balance?.overduePaise ?? 0) : '—'}
                    </TableCell>
                    <TableCell className="text-sm">{r.balance?.lastPaymentOn ? formatDisplayDate(r.balance.lastPaymentOn) : '—'}</TableCell>
                    <TableCell className="text-sm">{r.balance?.nextFollowUpOn ? formatDisplayDate(r.balance.nextFollowUpOn) : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pager page={page} pageSize={PAGE_SIZE} total={rows.length} onPage={setPage} />
        </>
      )}
    </ReceivablesShell>
  );
}
