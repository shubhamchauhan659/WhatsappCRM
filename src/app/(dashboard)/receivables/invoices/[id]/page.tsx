'use client';

import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Ban, IndianRupee, Loader2, MessageSquareText, NotebookPen, Pencil, ReceiptText, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createClient } from '@/lib/supabase/client';
import { useCan } from '@/hooks/use-can';
import { InvoiceStateBadge } from '@/components/receivables/badges';
import { CustomerLink, Kpi, Section } from '@/components/receivables/bits';
import { FollowUpDialog, InvoiceDialog, PaymentDialog, VoidPaymentDialog } from '@/components/receivables/dialogs';
import { ReminderComposer } from '@/components/receivables/reminder-composer';
import { EmptyPanel, LinkButton, ReceivablesShell, SnapshotStatus } from '@/components/receivables/shell';
import { FollowUpTimeline, PaymentList } from '@/components/receivables/timeline';
import { useReceivables } from '@/components/receivables/use-receivables';
import { formatDisplayDate } from '@/lib/receivables/dates';
import { formatPaise } from '@/lib/receivables/money';
import { evaluatePromises } from '@/lib/receivables/promises';
import { invoiceBadge } from '@/lib/receivables/status';
import type { PaymentKind, PaymentRow } from '@/lib/receivables/types';

export default function InvoiceDetailPage() {
  const t = useTranslations('Receivables');
  const { id } = useParams<{ id: string }>();
  const canEdit = useCan('send-messages');
  const state = useReceivables();
  const data = state.data;
  const invoice = data?.invoices.find((i) => i.id === id) ?? null;

  const [editOpen, setEditOpen] = useState(false);
  const [paymentKind, setPaymentKind] = useState<PaymentKind | null>(null);
  const [voidTarget, setVoidTarget] = useState<PaymentRow | null>(null);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [busy, setBusy] = useState(false);

  const payments = useMemo(() => data?.payments.filter((p) => p.invoice_id === id) ?? [], [data, id]);
  const followUps = useMemo(() => data?.followUps.filter((f) => f.invoice_id === id) ?? [], [data, id]);
  const promiseById = useMemo(() => {
    if (!data) return new Map();
    const evaluated = evaluatePromises({ followUps, invoices: data.invoices, payments: data.payments, today: data.today, timeZone: data.timeZone });
    return new Map(evaluated.map((e) => [e.followUp.id, e]));
  }, [data, followUps]);
  const invoiceMap = useMemo(() => new Map((data?.invoices ?? []).map((i) => [i.id, i])), [data]);

  async function setCancelled(cancel: boolean) {
    if (!invoice) return;
    setBusy(true);
    const { error } = await createClient()
      .from('invoices')
      .update(cancel ? { status: 'cancelled', cancel_reason: cancelReason.trim() || null } : { status: 'open' })
      .eq('id', invoice.id);
    setBusy(false);
    if (error) {
      toast.error(error.message?.includes('cancel_requires_no_settlement') ? t('invoice.cannotCancelPaid') : t('common.saveFailed'));
      return;
    }
    toast.success(cancel ? t('invoice.cancelled') : t('invoice.reopened'));
    setCancelOpen(false);
    void state.reload();
  }

  if (!data) {
    return (
      <ReceivablesShell title={t('invoice.title')}>
        <SnapshotStatus status={state.status} error={state.error} onRetry={state.reload} />
      </ReceivablesShell>
    );
  }
  if (!invoice) {
    return (
      <ReceivablesShell title={t('invoice.title')}>
        <EmptyPanel title={t('invoice.notFound')} action={<LinkButton href="/receivables/invoices">{t('invoice.backToList')}</LinkButton>} />
      </ReceivablesShell>
    );
  }

  const money = (p: number) => formatPaise(p, invoice.currency);
  const isOpen = invoice.status === 'open';
  const owes = isOpen && invoice.outstanding_paise > 0;
  const settled = invoice.paid_paise + invoice.credited_paise > 0;

  return (
    <ReceivablesShell
      title={t('invoice.heading', { number: invoice.invoice_number })}
      description={
        <span className="inline-flex flex-wrap items-center gap-2">
          <CustomerLink customer={data.customers.get(invoice.contact_id)} contactId={invoice.contact_id} />
          <InvoiceStateBadge badge={invoiceBadge(invoice, data.today)} />
        </span>
      }
      actions={
        <>
          {owes && (
            <Button disabled={!canEdit} onClick={() => setPaymentKind('payment')}>
              <IndianRupee className="size-4" />
              {t('invoice.recordPayment')}
            </Button>
          )}
          {owes && (
            <Button variant="outline" disabled={!canEdit} onClick={() => setReminderOpen(true)}>
              <MessageSquareText className="size-4" />
              {t('invoice.sendReminder')}
            </Button>
          )}
          <Button variant="outline" disabled={!canEdit} onClick={() => setFollowUpOpen(true)}>
            <NotebookPen className="size-4" />
            {t('invoice.logFollowUp')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        <Kpi label={t('fields.total')} value={money(invoice.total_paise)} />
        <Kpi label={t('fields.paid')} value={money(invoice.paid_paise)} />
        <Kpi label={t('fields.credited')} value={money(invoice.credited_paise)} />
        <Kpi label={t('fields.outstanding')} value={money(invoice.outstanding_paise)} tone={owes ? 'danger' : undefined} />
      </div>
      <div className="grid gap-1 rounded-lg border border-border p-3 text-sm sm:grid-cols-3">
        <p>
          <span className="text-muted-foreground">{t('fields.invoiceDate')}: </span>
          {formatDisplayDate(invoice.issue_date)}
        </p>
        <p>
          <span className="text-muted-foreground">{t('fields.dueDate')}: </span>
          {formatDisplayDate(invoice.due_date)}
        </p>
        <p>
          <span className="text-muted-foreground">{t('fields.source')}: </span>
          {t(`invoice.source.${invoice.source}`)}
        </p>
        {invoice.notes && <p className="sm:col-span-3 whitespace-pre-wrap">{invoice.notes}</p>}
        {invoice.status === 'cancelled' && (
          <p className="sm:col-span-3 text-red-700 dark:text-red-300">{t('invoice.cancelledNote', { reason: invoice.cancel_reason ?? '—' })}</p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {isOpen && (
          <Button size="sm" variant="ghost" disabled={!canEdit} onClick={() => setEditOpen(true)}>
            <Pencil className="size-3.5" />
            {t('invoice.edit')}
          </Button>
        )}
        {owes && (
          <Button size="sm" variant="ghost" disabled={!canEdit} onClick={() => setPaymentKind('credit_note')}>
            <ReceiptText className="size-3.5" />
            {t('invoice.addCreditNote')}
          </Button>
        )}
        {isOpen && !settled && (
          <Button size="sm" variant="ghost" disabled={!canEdit} onClick={() => setCancelOpen(true)}>
            <Ban className="size-3.5" />
            {t('invoice.cancel')}
          </Button>
        )}
        {invoice.status === 'cancelled' && (
          <Button size="sm" variant="ghost" disabled={!canEdit || busy} onClick={() => setCancelled(false)}>
            <RotateCcw className="size-3.5" />
            {t('invoice.reopen')}
          </Button>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t('invoice.paymentsTitle')}>
          <PaymentList payments={payments} currency={invoice.currency} canVoid={canEdit} onVoid={setVoidTarget} />
        </Section>
        <Section title={t('invoice.followUpsTitle')}>
          <FollowUpTimeline followUps={followUps} invoices={invoiceMap} promises={promiseById} timeZone={data.timeZone} currency={invoice.currency} />
        </Section>
      </div>
      <p className="text-xs text-muted-foreground">{t('invoice.derivedNote')}</p>

      <InvoiceDialog open={editOpen} onOpenChange={setEditOpen} snapshot={data} invoice={invoice} onSaved={() => void state.reload()} />
      {paymentKind && (
        <PaymentDialog
          open={!!paymentKind}
          onOpenChange={(o) => !o && setPaymentKind(null)}
          snapshot={data}
          invoice={invoice}
          kind={paymentKind}
          onSaved={() => void state.reload()}
        />
      )}
      <VoidPaymentDialog open={!!voidTarget} onOpenChange={(o) => !o && setVoidTarget(null)} payment={voidTarget} currency={invoice.currency} onSaved={() => void state.reload()} />
      <FollowUpDialog
        open={followUpOpen}
        onOpenChange={setFollowUpOpen}
        snapshot={data}
        contactId={invoice.contact_id}
        defaultInvoiceId={invoice.id}
        onSaved={() => void state.reload()}
      />
      {reminderOpen && (
        <ReminderComposer
          open={reminderOpen}
          onOpenChange={setReminderOpen}
          snapshot={data}
          contactId={invoice.contact_id}
          preselectInvoiceIds={[invoice.id]}
          onRecorded={() => void state.reload()}
        />
      )}
      <Dialog open={cancelOpen} onOpenChange={(o) => !busy && setCancelOpen(o)}>
        <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('invoice.cancelTitle')}</DialogTitle>
            <DialogDescription>{t('invoice.cancelDesc', { number: invoice.invoice_number })}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="cancel-reason">{t('fields.cancelReason')}</Label>
            <Input id="cancel-reason" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} maxLength={500} />
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setCancelOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => setCancelled(true)}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {t('invoice.confirmCancel')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ReceivablesShell>
  );
}
