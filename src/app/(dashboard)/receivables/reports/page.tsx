'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Download, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { fetchAllPages } from '@/lib/supabase/paged-query';
import { FOLLOW_UP_MESSAGE_COLUMNS } from '@/lib/receivables/types';
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
  const [busy, setBusy] = useState<string | null>(null);

  // Message bodies are not in the snapshot; the follow-up export fetches them.
  async function followUpsWithMessages(d: ExportData): Promise<string> {
    const supabase = createClient();
    const ids = d.followUps.filter((f) => f.has_message).map((f) => f.id);
    const bodies = new Map<string, string | null>();
    if (ids.length > 0) {
      const rows = await fetchAllPages<{ id: string; message: string | null }>((from, to) =>
        supabase.from('follow_ups').select(FOLLOW_UP_MESSAGE_COLUMNS).not('message', 'is', null).order('id').range(from, to),
      );
      for (const r of rows) bodies.set(r.id, r.message);
    }
    return followUpsCsv({ ...d, followUps: d.followUps.map((f) => ({ ...f, message: bodies.get(f.id) ?? null })) });
  }

  const exports: { key: string; file: string; build: () => string | Promise<string> }[] = exportData
    ? [
        { key: 'aging', file: `aging-${stamp}.csv`, build: () => agingCsv(exportData) },
        { key: 'invoices', file: `invoices-${stamp}.csv`, build: () => invoicesCsv(exportData) },
        { key: 'payments', file: `payments-${stamp}.csv`, build: () => paymentsCsv(exportData) },
        { key: 'followUps', file: `follow-ups-${stamp}.csv`, build: () => followUpsWithMessages(exportData) },
        { key: 'customers', file: `customers-${stamp}.csv`, build: () => customersCsv(exportData) },
      ]
    : [];

  async function runExport(e: (typeof exports)[number]) {
    setBusy(e.key);
    try {
      downloadCsv(e.file, await e.build());
    } catch {
      toast.error(t('common.loadFailed'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <ReceivablesShell title={t('reports.title')} description={t('reports.subtitle')}>
      {!data && <SnapshotStatus status={state.status} error={state.error} onRetry={state.reload} />}
      {data && (
        <>
          <Section title={t('reports.exportsTitle')}>
            <div className="flex flex-wrap gap-2 px-4 py-3">
              {exports.map((e) => (
                <Button key={e.key} variant="outline" size="sm" disabled={busy !== null} onClick={() => void runExport(e)}>
                  {busy === e.key ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
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
