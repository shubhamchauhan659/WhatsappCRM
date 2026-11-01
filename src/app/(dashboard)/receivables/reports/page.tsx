'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CustomerLink, Section } from '@/components/receivables/bits';
import { EmptyPanel, ReceivablesShell, SnapshotStatus } from '@/components/receivables/shell';
import { useReceivables } from '@/components/receivables/use-receivables';
import { downloadCsv } from '@/lib/receivables/csv';
import { agingByCustomer, agingCsv, customersCsv, followUpsCsv, invoicesCsv, paymentsCsv, type ExportData } from '@/lib/receivables/exports';
import { formatPaise } from '@/lib/receivables/money';

export default function ReportsPage() {
  const t = useTranslations('Receivables');
  const state = useReceivables();
  const data = state.data;
  const exportData: ExportData | null = useMemo(
    () =>
      data
        ? { invoices: data.invoices, payments: data.payments, followUps: data.followUps, customers: data.customers, today: data.today, currency: data.currency }
        : null,
    [data],
  );
  const aging = useMemo(() => (exportData ? agingByCustomer(exportData) : []), [exportData]);
  const totals = aging.reduce(
    (s, r) => ({ current: s.current + r.current, d1_7: s.d1_7 + r.d1_7, d8_30: s.d8_30 + r.d8_30, d31_plus: s.d31_plus + r.d31_plus, total: s.total + r.total }),
    { current: 0, d1_7: 0, d8_30: 0, d31_plus: 0, total: 0 },
  );
  const money = (p: number) => (p ? formatPaise(p, data?.currency ?? 'INR') : '—');
  const stamp = data?.today ?? 'export';

  const exports = exportData
    ? [
        { key: 'aging', file: `aging-${stamp}.csv`, build: () => agingCsv(exportData) },
        { key: 'invoices', file: `invoices-${stamp}.csv`, build: () => invoicesCsv(exportData) },
        { key: 'payments', file: `payments-${stamp}.csv`, build: () => paymentsCsv(exportData) },
        { key: 'followUps', file: `follow-ups-${stamp}.csv`, build: () => followUpsCsv(exportData) },
        { key: 'customers', file: `customers-${stamp}.csv`, build: () => customersCsv(exportData) },
      ]
    : [];

  return (
    <ReceivablesShell title={t('reports.title')} description={t('reports.subtitle')}>
      {!data && <SnapshotStatus status={state.status} error={state.error} onRetry={state.reload} />}
      {data && (
        <>
          <Section title={t('reports.exportsTitle')}>
            <div className="flex flex-wrap gap-2 px-4 py-3">
              {exports.map((e) => (
                <Button key={e.key} variant="outline" size="sm" onClick={() => downloadCsv(e.file, e.build())}>
                  <Download className="size-3.5" />
                  {t(`reports.exports.${e.key}`)}
                </Button>
              ))}
            </div>
            <p className="px-4 pb-3 text-xs text-muted-foreground">{t('reports.exportsHint')}</p>
          </Section>
          <Section title={t('reports.agingTitle')}>
            {aging.length === 0 ? (
              <EmptyPanel title={t('reports.agingEmpty')} />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('fields.customer')}</TableHead>
                      <TableHead className="text-right">{t('aging.current')}</TableHead>
                      <TableHead className="text-right">{t('aging.d1_7')}</TableHead>
                      <TableHead className="text-right">{t('aging.d8_30')}</TableHead>
                      <TableHead className="text-right">{t('aging.d31_plus')}</TableHead>
                      <TableHead className="text-right">{t('fields.outstanding')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {aging.map((r) => (
                      <TableRow key={r.contactId}>
                        <TableCell className="max-w-56 truncate">
                          <CustomerLink customer={data.customers.get(r.contactId)} contactId={r.contactId} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{money(r.current)}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(r.d1_7)}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(r.d8_30)}</TableCell>
                        <TableCell className="text-right tabular-nums text-red-600 dark:text-red-400">{money(r.d31_plus)}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{money(r.total)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell className="font-semibold">{t('reports.total')}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(totals.current)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(totals.d1_7)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(totals.d8_30)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(totals.d31_plus)}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{money(totals.total)}</TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            )}
          </Section>
        </>
      )}
    </ReceivablesShell>
  );
}
