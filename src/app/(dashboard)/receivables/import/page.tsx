'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Download, FileUp, Loader2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { createClient } from '@/lib/supabase/client';
import { fetchAllPages } from '@/lib/supabase/paged-query';
import { Section } from '@/components/receivables/bits';
import { ReceivablesShell, SnapshotStatus } from '@/components/receivables/shell';
import { useReceivables } from '@/components/receivables/use-receivables';
import { downloadCsv, parseCsv } from '@/lib/receivables/csv';
import { formatDisplayDate } from '@/lib/receivables/dates';
import { MAX_IMPORT_ROWS, SAMPLE_IMPORT_CSV, planInvoiceImport, type ExistingCustomer, type RowIssue } from '@/lib/receivables/import';
import { runInvoiceImport, type ImportRunResult } from '@/lib/receivables/import-run';
import { formatPaise } from '@/lib/receivables/money';
import { cn } from '@/lib/utils';

const PREVIEW_LIMIT = 200;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

export default function ImportPage() {
  const t = useTranslations('Receivables');
  const { accountId, user } = useAuth();
  const canEdit = useCan('send-messages');
  const state = useReceivables();
  const data = state.data;
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [table, setTable] = useState<string[][] | null>(null);
  const [creditDays, setCreditDays] = useState('30');
  const [linkNames, setLinkNames] = useState(true);
  const [existing, setExisting] = useState<ExistingCustomer[] | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<ImportRunResult | null>(null);

  useEffect(() => {
    if (!accountId) return;
    const supabase = createClient();
    fetchAllPages<ExistingCustomer>((from, to) =>
      supabase.from('contacts').select('id, name, company, phone_normalized').eq('account_id', accountId).order('id').range(from, to),
    )
      .then(setExisting)
      .catch(() => setExisting([]));
  }, [accountId, result]);

  const plan = useMemo(() => {
    if (!table || !data || !existing) return null;
    return planInvoiceImport(table, {
      existingCustomers: existing,
      existingInvoiceNumbers: new Set(data.invoices.map((i) => i.invoice_number.toUpperCase())),
      defaultCreditDays: Math.min(365, Math.max(0, Number.parseInt(creditDays, 10) || 0)),
      linkNameMatches: linkNames,
    });
  }, [table, data, existing, creditDays, linkNames]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setResult(null);
    if (file.size > MAX_FILE_BYTES) {
      toast.error(t('import.tooLarge'));
      return;
    }
    const rows = parseCsv(await file.text());
    if (rows.length < 2) {
      toast.error(t('import.noRows'));
      return;
    }
    setFileName(file.name);
    setTable(rows);
  }

  async function runImport() {
    if (!plan || !accountId || !user || !data) return;
    setRunning(true);
    setProgress({ done: 0, total: plan.summary.ready });
    try {
      const res = await runInvoiceImport(createClient(), {
        plan,
        accountId,
        userId: user.id,
        currency: data.currency,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      setResult(res);
      if (res.imported > 0) toast.success(t('import.toastImported', { count: res.imported }));
      if (res.failed.length > 0) toast.error(t('import.toastFailed', { count: res.failed.length }));
      setTable(null);
      setFileName(null);
      if (fileRef.current) fileRef.current.value = '';
      await state.reload();
    } catch {
      toast.error(t('import.toastError'));
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  const issue = (i: RowIssue): string => {
    switch (i.code) {
      case 'bad_amount':
      case 'bad_paid_amount':
        return `${t(`import.issues.${i.code}`)}: ${t(`validation.amount.${i.reason}`)}`;
      case 'bad_invoice_date':
      case 'bad_due_date':
      case 'bad_phone':
        return t(`import.issues.${i.code}`, { value: i.value });
      case 'duplicate_in_file':
        return t('import.issues.duplicate_in_file', { row: i.firstRow });
      default:
        return t(`import.issues.${i.code}`);
    }
  };

  return (
    <ReceivablesShell
      title={t('import.title')}
      description={t('import.subtitle')}
      actions={
        <Button variant="outline" onClick={() => downloadCsv('paisafollow-sample.csv', SAMPLE_IMPORT_CSV)}>
          <Download className="size-4" />
          {t('import.sample')}
        </Button>
      }
    >
      {!data && <SnapshotStatus status={state.status} error={state.error} onRetry={state.reload} />}
      {data && (
        <>
          <div className="grid gap-4 rounded-lg border border-border p-4 md:grid-cols-[minmax(0,1fr)_auto]">
            <div className="grid gap-2 text-sm">
              <p>{t('import.howTo')}</p>
              <ul className="list-disc pl-5 text-xs text-muted-foreground">
                <li>{t('import.colsRequired')}</li>
                <li>{t('import.colsOptional')}</li>
                <li>{t('import.dateFormat')}</li>
                <li>{t('import.limits', { rows: MAX_IMPORT_ROWS })}</li>
              </ul>
            </div>
            <div className="grid content-start gap-3 md:w-64">
              <input ref={fileRef} id="csv-file" type="file" accept=".csv,text/csv" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={onFile} disabled={!canEdit || running} />
              <Button onClick={() => fileRef.current?.click()} disabled={!canEdit || running}>
                <FileUp className="size-4" />
                {fileName ? t('import.chooseAnother') : t('import.choose')}
              </Button>
              {fileName && <p className="truncate text-xs text-muted-foreground">{fileName}</p>}
              <div className="grid gap-1.5">
                <Label htmlFor="credit-days">{t('import.creditDays')}</Label>
                <Input id="credit-days" inputMode="numeric" value={creditDays} onChange={(e) => setCreditDays(e.target.value.replace(/\D/g, '').slice(0, 3))} />
                <p className="text-[11px] text-muted-foreground">{t('import.creditDaysHint')}</p>
              </div>
              <label className="flex items-start gap-2 text-xs">
                <Checkbox checked={linkNames} onCheckedChange={(c) => setLinkNames(!!c)} />
                <span>{t('import.linkNames')}</span>
              </label>
            </div>
          </div>

          {plan && plan.missingRequiredColumns.length > 0 && (
            <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {t('import.missingColumns', { columns: plan.missingRequiredColumns.map((c) => t(`import.columns.${c}`)).join(', ') })}
            </div>
          )}

          {plan && plan.missingRequiredColumns.length === 0 && (
            <Section
              title={t('import.previewTitle')}
              action={
                <Button size="sm" disabled={!canEdit || running || plan.summary.ready === 0} onClick={runImport}>
                  {running ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                  {running && progress ? t('import.running', { done: progress.done, total: progress.total }) : t('import.run', { count: plan.summary.ready })}
                </Button>
              }
            >
              <p className="px-4 pt-3 text-xs text-muted-foreground">
                {t('import.summary', {
                  total: plan.summary.total,
                  ready: plan.summary.ready,
                  skipped: plan.summary.skipped,
                  errors: plan.summary.errors,
                  customers: plan.summary.newCustomers,
                })}
              </p>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-14">{t('import.row')}</TableHead>
                      <TableHead>{t('fields.customer')}</TableHead>
                      <TableHead>{t('fields.invoiceNumber')}</TableHead>
                      <TableHead>{t('fields.dueDate')}</TableHead>
                      <TableHead className="text-right">{t('fields.total')}</TableHead>
                      <TableHead>{t('fields.status')}</TableHead>
                      <TableHead>{t('import.messages')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {plan.rows.slice(0, PREVIEW_LIMIT).map((r) => (
                      <TableRow key={r.rowNumber} className={cn(r.status === 'error' && 'bg-destructive/5')}>
                        <TableCell className="text-xs text-muted-foreground">{r.rowNumber}</TableCell>
                        <TableCell className="max-w-48 truncate text-sm">{r.customerName || '—'}</TableCell>
                        <TableCell className="text-sm">{r.invoiceNumber || '—'}</TableCell>
                        <TableCell className="text-sm">{r.dueDate ? formatDisplayDate(r.dueDate) : '—'}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">{r.amountPaise ? formatPaise(r.amountPaise, data.currency) : '—'}</TableCell>
                        <TableCell className="text-xs font-medium">{t(`import.status.${r.status}`)}</TableCell>
                        <TableCell className="max-w-80 text-xs">
                          {r.errors.map((e, i) => (
                            <p key={`e${i}`} className="text-destructive">
                              {issue(e)}
                            </p>
                          ))}
                          {r.warnings.map((w, i) => (
                            <p key={`w${i}`} className="text-amber-700 dark:text-amber-300">
                              {issue(w)}
                            </p>
                          ))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {plan.rows.length > PREVIEW_LIMIT && <p className="px-4 py-2 text-xs text-muted-foreground">{t('import.previewTruncated', { count: PREVIEW_LIMIT })}</p>}
            </Section>
          )}

          {result && (
            <Section title={t('import.resultTitle')}>
              <div className="grid gap-1 px-4 py-3 text-sm">
                <p>{t('import.resultLine', { imported: result.imported, skipped: result.skipped, customers: result.customersCreated, payments: result.paymentsRecorded })}</p>
                {result.failed.map((f) => (
                  <p key={f.rowNumber} className="text-xs text-destructive">
                    {t('import.failedRow', { row: f.rowNumber, reason: f.reason })}
                  </p>
                ))}
                <Link href="/receivables/queue" className="mt-2 text-sm text-primary hover:underline">
                  {t('import.goToQueue')}
                </Link>
              </div>
            </Section>
          )}
        </>
      )}
    </ReceivablesShell>
  );
}
