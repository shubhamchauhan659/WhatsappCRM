'use client';

import Link from 'next/link';
import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Plus, Search } from 'lucide-react';
import { GatedButton } from '@/components/ui/gated-button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCan } from '@/hooks/use-can';
import { InvoiceStateBadge } from '@/components/receivables/badges';
import { CustomerLink } from '@/components/receivables/bits';
import { InvoiceDialog } from '@/components/receivables/dialogs';
import { EmptyPanel, Pager, ReceivablesShell, SnapshotStatus, selectClassName } from '@/components/receivables/shell';
import { useReceivables } from '@/components/receivables/use-receivables';
import { formatDisplayDate } from '@/lib/receivables/dates';
import { formatPaise } from '@/lib/receivables/money';
import { daysOverdue, invoiceBadge, paymentState } from '@/lib/receivables/status';
import { customerDisplayName } from '@/lib/receivables/types';

const PAGE_SIZE = 25;
const FILTERS = ['open', 'overdue', 'paid', 'cancelled', 'all'] as const;
type Filter = (typeof FILTERS)[number];

export default function InvoicesPage() {
  return (
    <Suspense fallback={null}>
      <InvoicesPageInner />
    </Suspense>
  );
}

function InvoicesPageInner() {
  const t = useTranslations('Receivables');
  const router = useRouter();
  const params = useSearchParams();
  const canEdit = useCan('send-messages');
  const state = useReceivables();
  const data = state.data;
  const filter: Filter = (FILTERS as readonly string[]).includes(params.get('status') ?? '') ? (params.get('status') as Filter) : 'open';
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [invoiceOpen, setInvoiceOpen] = useState(false);

  const rows = useMemo(() => {
    if (!data) return [];
    const term = search.trim().toLowerCase();
    return data.invoices
      .filter((inv) => {
        const s = paymentState(inv);
        if (filter === 'open') return s === 'unpaid' || s === 'partially_paid';
        if (filter === 'overdue') return daysOverdue(inv, data.today) > 0;
        if (filter === 'paid') return s === 'paid';
        if (filter === 'cancelled') return s === 'cancelled';
        return true;
      })
      .filter((inv) => {
        if (!term) return true;
        const c = data.customers.get(inv.contact_id);
        return (
          inv.invoice_number.toLowerCase().includes(term) ||
          customerDisplayName(c).toLowerCase().includes(term) ||
          (c?.phone ?? '').includes(term)
        );
      })
      .sort((a, b) => a.due_date.localeCompare(b.due_date) || a.invoice_number.localeCompare(b.invoice_number));
  }, [data, filter, search]);

  const total = rows.reduce((s, r) => s + (r.currency === data?.currency ? r.outstanding_paise : 0), 0);
  const visible = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const setFilter = (next: Filter) => {
    const p = new URLSearchParams(params.toString());
    p.set('status', next);
    router.replace(`/receivables/invoices?${p.toString()}`, { scroll: false });
    setPage(0);
  };

  return (
    <ReceivablesShell
      title={t('invoices.title')}
      description={data ? t('invoices.subtitle', { count: rows.length, amount: formatPaise(total, data.currency) }) : undefined}
      actions={
        <GatedButton canAct={canEdit} gateReason={t('common.gateRecord')} disabled={!data} onClick={() => setInvoiceOpen(true)}>
          <Plus className="size-4" />
          {t('common.addInvoice')}
        </GatedButton>
      }
    >
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label={t('invoices.searchLabel')}
            placeholder={t('invoices.searchPlaceholder')}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            className="pl-8"
          />
        </div>
        <select aria-label={t('invoices.filterLabel')} className={`${selectClassName} sm:w-48`} value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
          {FILTERS.map((f) => (
            <option key={f} value={f}>
              {t(`invoices.filters.${f}`)}
            </option>
          ))}
        </select>
      </div>

      {!data && <SnapshotStatus status={state.status} error={state.error} onRetry={state.reload} />}
      {data && rows.length === 0 && (
        <EmptyPanel title={data.invoices.length === 0 ? t('invoices.emptyTitle') : t('invoices.noMatch')} hint={data.invoices.length === 0 ? t('invoices.emptyHint') : undefined} />
      )}
      {data && rows.length > 0 && (
        <>
          {/* Mobile: cards */}
          <ul className="grid gap-2 md:hidden">
            {visible.map((inv) => (
              <li key={inv.id} className="rounded-lg border border-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/receivables/invoices/${inv.id}`} className="font-medium hover:underline">
                      {inv.invoice_number}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">{customerDisplayName(data.customers.get(inv.contact_id))}</p>
                  </div>
                  <span className="font-semibold tabular-nums">{formatPaise(inv.outstanding_paise, inv.currency)}</span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{t('invoices.dueOn', { date: formatDisplayDate(inv.due_date) })}</span>
                  <InvoiceStateBadge badge={invoiceBadge(inv, data.today)} />
                </div>
              </li>
            ))}
          </ul>
          {/* Desktop: table */}
          <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('fields.invoiceNumber')}</TableHead>
                  <TableHead>{t('fields.customer')}</TableHead>
                  <TableHead>{t('fields.dueDate')}</TableHead>
                  <TableHead className="text-right">{t('fields.total')}</TableHead>
                  <TableHead className="text-right">{t('fields.outstanding')}</TableHead>
                  <TableHead>{t('fields.status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell>
                      <Link href={`/receivables/invoices/${inv.id}`} className="font-medium hover:underline">
                        {inv.invoice_number}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-56 truncate">
                      <CustomerLink customer={data.customers.get(inv.contact_id)} contactId={inv.contact_id} />
                    </TableCell>
                    <TableCell className="text-sm">{formatDisplayDate(inv.due_date)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPaise(inv.total_paise, inv.currency)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatPaise(inv.outstanding_paise, inv.currency)}</TableCell>
                    <TableCell>
                      <InvoiceStateBadge badge={invoiceBadge(inv, data.today)} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pager page={page} pageSize={PAGE_SIZE} total={rows.length} onPage={setPage} />
        </>
      )}
      {data && <InvoiceDialog open={invoiceOpen} onOpenChange={setInvoiceOpen} snapshot={data} onSaved={(id) => { void state.reload(); router.push(`/receivables/invoices/${id}`); }} />}
    </ReceivablesShell>
  );
}
