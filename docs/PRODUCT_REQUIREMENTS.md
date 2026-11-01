# PaisaFollow — Product requirements

## Problem and outcome

Indian wholesalers, distributors and traders sell on credit and chase
payments from Excel sheets, notebooks or Tally. Overdue money is buried,
promises are forgotten, and reminders depend on memory.

**Outcome:** *Every morning, know whom to contact, how much is overdue, what
the customer promised, and what to do next.*

PaisaFollow is **not** a CRM or an accounting package. It is a focused
receivables workflow on top of an existing CRM base.

**Target users:** owners and accountants of small B2B suppliers (electrical,
hardware, building material, packaging, auto parts) with roughly 20–500 credit
customers.

## P0 — MVP scope and status

| # | Requirement | Acceptance criteria | Status |
|---|---|---|---|
| A | Auth and business setup | Reuse signup/login. Business profile: name, logo URL, address, phone, email, GSTIN, UPI ID, currency (default INR), timezone (default Asia/Kolkata). Each business sees only its own records. | ✅ |
| B | Customers | List with outstanding, overdue, last payment, next follow-up. Search and filter. CSV import with row-level errors. Duplicates flagged, never silently merged. | ✅ |
| C | Invoices and payments | Create and edit invoices. Record partial payments and credit notes. Void (never delete) payments. Cancel invoices without settlement. Status derived from payments only. | ✅ |
| D | Receivables dashboard | Total outstanding and overdue; ageing 1–7 / 8–30 / 31+; top overdue customers; follow-ups due today; overdue with no follow-up; promises due or missed; recent payments and activity. All figures computed from stored rows. | ✅ |
| E | Follow-up management | Date/time, channel, summary, 9 statuses, next follow-up date, promise date and amount, dispute reason, internal notes, recorded-by user. Missed promises surface automatically. No double counting. | ✅ |
| F | Reminder drafts | English, Hinglish and Hindi × polite, standard, firm. Editable, with every variable previewed. No threats. Copy / WhatsApp / SMS / email. "Sent" only after the user confirms. | ✅ |
| G | Daily queue | Deterministic ranking with explained reasons. Disputes listed separately. No payment-likelihood claims. | ✅ |
| — | Security | RLS isolation, composite tenant FKs, audit log, rate-limited account deletion, CSV formula-injection defence, data export. | ✅ (see SECURITY.md for residual risks) |

### Pages delivered

Login and registration (existing) · Business setup (Settings → Business
profile) · Dashboard `/receivables` · Customers · Customer detail with payment
and promise history · Invoices and invoice detail · Follow-up queue
`/receivables/queue` · Follow-up history · Reminder editor (dialog) · CSV
import · Reports and exports · Settings with account deletion.

## P1 — next release (not built)

Automated email reminders (optional SMTP) · scheduled daily summary to the
owner (email / Telegram / web push) · per-business reminder templates · Hindi
UI catalogue (`messages/hi.json`) · multi-user polish (already supported by
wacrm roles) · optional AI rewrite behind a flag with deterministic fallback.

## P2 — only after validation

Official WhatsApp Business Platform sending for reminders (the base already
supports the Cloud API) · delivery-status webhooks for reminders · Tally /
Busy / Zoho integrations · advanced analytics · paid plans and billing ·
multi-business agency accounts.

## Non-goals

Creating GST invoices or PDFs (the business's accounting software does that).
Payment collection or a gateway (the reminder carries the business's own UPI
ID). Credit scoring or predictions. Unofficial WhatsApp automation.

## Pilot success metrics (first 5–10 businesses, 4 weeks)

- Owner opens "Today" on at least 4 days a week.
- At least 70% of overdue customers get a logged follow-up each week.
- Every promise recorded gets resolved: kept, or missed then followed up.
- Days sales outstanding (DSO), or overdue ₹ at 31+ days, falls against the
  owner's own baseline.
- Qualitative: "I would be upset if this went away" from at least 3 owners.

## Future plan structure (Phase E — do not build before validation)

| Free | Paid (later) |
|---|---|
| Manual follow-ups, queue, reminders by copy/link, CSV import and export, 1 user, limited history/volume | Automated email/WhatsApp reminders, daily summaries, more users, advanced reports, integrations |

Entitlements will be enforced server-side (see ARCHITECTURE.md §7). Existing
open-source functionality will not be artificially blocked.
