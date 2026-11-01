'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { MessageSquareText, NotebookPen, Phone, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCan } from '@/hooks/use-can';
import { InvoiceStateBadge, PromiseStateBadge } from '@/components/receivables/badges';
import { Kpi, Section } from '@/components/receivables/bits';
import { FollowUpDialog, InvoiceDialog } from '@/components/receivables/dialogs';
import { ReminderComposer } from '@/components/receivables/reminder-composer';
import { AnchorButton, EmptyPanel, LinkButton, ReceivablesShell, SnapshotStatus } from '@/components/receivables/shell';
import { FollowUpTimeline, PaymentList } from '@/components/receivables/timeline';
import { useReceivables } from '@/components/receivables/use-receivables';
import { formatDisplayDate } from '@/lib/receivables/dates';
import { formatPaise } from '@/lib/receivables/money';
import { customerBalances } from '@/lib/receivables/overview';
import { evaluatePromises } from '@/lib/receivables/promises';
import { telLink } from '@/lib/receivables/phone';
import { invoiceBadge } from '@/lib/receivables/status';
import { customerDisplayName } from '@/lib/receivables/types';

export default function CustomerDetailPage() {
  const t = useTranslations('Receivables');
  const { id } = useParams<{ id: string }>();
  const canEdit = useCan('send-messages');
  const state = useReceivables();
  const data = state.data;
  const customer = data?.customers.get(id);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);

  const view = useMemo(() => {
    if (!data) return null;
    const invoices = data.invoices.filter((i) => i.contact_id === id).sort((a, b) => b.due_date.localeCompare(a.due_date));
    const invoiceIds = new Set(invoices.map((i) => i.id));
    const payments = data.payments.filter((p) => invoiceIds.has(p.invoice_id));
    const followUps = data.followUps.filter((f) => f.contact_id === id);
    const promises = evaluatePromises({ followUps, invoices, payments, today: data.today, timeZone: data.timeZone });
    const balance = customerBalances(invoices, payments, followUps, data.today, data.currency).get(id);
    return {
      invoices,
      payments,
      followUps,
      promises,
      promiseById: new Map(promises.map((p) => [p.followUp.id, p])),
      invoiceMap: new Map(invoices.map((i) => [i.id, i])),
      balance,
    };
  }, [data, id]);

  if (!data || !view) {
    return (
      <ReceivablesShell title={t('customer.title')}>
        <SnapshotStatus status={state.status} error={state.error} onRetry={state.reload} />
      </ReceivablesShell>
    );
  }
  if (!customer) {
    return (
      <ReceivablesShell title={t('customer.title')}>
        <EmptyPanel title={t('customer.notFound')} hint={t('customer.notFoundHint')} action={<LinkButton href="/receivables/customers">{t('customer.backToList')}</LinkButton>} />
      </ReceivablesShell>
    );
  }

  const money = (p: number) => formatPaise(p, data.currency);
  const tel = telLink(customer.phone);
  const missed = view.promises.filter((p) => p.state === 'missed').length;
  const owes = (view.balance?.outstandingPaise ?? 0) > 0;

  return (
    <ReceivablesShell
      title={customerDisplayName(customer)}
      description={[customer.phone, customer.email].filter(Boolean).join(' · ') || undefined}
      actions={
        <>
          {owes && (
            <Button disabled={!canEdit} onClick={() => setReminderOpen(true)}>
              <MessageSquareText className="size-4" />
              {t('customer.sendReminder')}
            </Button>
          )}
          <Button variant="outline" disabled={!canEdit} onClick={() => setFollowUpOpen(true)}>
            <NotebookPen className="size-4" />
            {t('customer.logFollowUp')}
          </Button>
          <Button variant="outline" disabled={!canEdit} onClick={() => setInvoiceOpen(true)}>
            <Plus className="size-4" />
            {t('common.addInvoice')}
          </Button>
          {tel && (
            <AnchorButton variant="ghost" href={tel}>
              <Phone className="size-4" />
              {t('queue.call')}
            </AnchorButton>
          )}
        </>
      }
    >
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        <Kpi label={t('fields.outstanding')} value={money(view.balance?.outstandingPaise ?? 0)} hint={t('overview.kpi.openInvoices', { count: view.balance?.openInvoices ?? 0 })} />
        <Kpi label={t('fields.overdue')} value={money(view.balance?.overduePaise ?? 0)} tone={(view.balance?.overduePaise ?? 0) > 0 ? 'danger' : undefined} hint={view.balance?.maxDaysOverdue ? t('customer.oldest', { days: view.balance.maxDaysOverdue }) : undefined} />
        <Kpi label={t('fields.lastPayment')} value={view.balance?.lastPaymentOn ? formatDisplayDate(view.balance.lastPaymentOn) : '—'} />
        <Kpi label={t('customer.missedPromises')} value={String(missed)} tone={missed > 0 ? 'danger' : undefined} hint={t('customer.promisesTotal', { count: view.promises.length })} />
      </div>

      <Section title={t('customer.invoicesTitle')}>
        {view.invoices.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">{t('customer.noInvoices')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {view.invoices.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <div className="min-w-0">
                  <Link href={`/receivables/invoices/${inv.id}`} className="font-medium hover:underline">
                    {inv.invoice_number}
                  </Link>
                  <p className="text-xs text-muted-foreground">{t('invoices.dueOn', { date: formatDisplayDate(inv.due_date) })}</p>
                </div>
                <div className="flex items-center gap-3">
                  <InvoiceStateBadge badge={invoiceBadge(inv, data.today)} />
                  <span className="w-28 text-right font-medium tabular-nums">{formatPaise(inv.outstanding_paise, inv.currency)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {view.promises.length > 0 && (
        <Section title={t('customer.promisesTitle')}>
          <ul className="divide-y divide-border">
            {[...view.promises]
              .sort((a, b) => (b.followUp.promise_date as string).localeCompare(a.followUp.promise_date as string))
              .map((p) => (
                <li key={p.followUp.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                  <span>{t('overview.promiseLine', { amount: money(p.promisedPaise), date: formatDisplayDate(p.followUp.promise_date as string) })}</span>
                  <PromiseStateBadge state={p.state} />
                </li>
              ))}
          </ul>
        </Section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t('customer.followUpsTitle')}>
          <FollowUpTimeline followUps={view.followUps} invoices={view.invoiceMap} promises={view.promiseById} timeZone={data.timeZone} currency={data.currency} />
        </Section>
        <Section title={t('customer.paymentsTitle')}>
          <PaymentList payments={view.payments} invoices={view.invoiceMap} currency={data.currency} canVoid={false} />
        </Section>
      </div>

      <InvoiceDialog open={invoiceOpen} onOpenChange={setInvoiceOpen} snapshot={data} defaultCustomer={customer} onSaved={() => void state.reload()} />
      <FollowUpDialog open={followUpOpen} onOpenChange={setFollowUpOpen} snapshot={data} contactId={id} onSaved={() => void state.reload()} />
      {reminderOpen && (
        <ReminderComposer open={reminderOpen} onOpenChange={setReminderOpen} snapshot={data} contactId={id} onRecorded={() => void state.reload()} />
      )}
    </ReceivablesShell>
  );
}
