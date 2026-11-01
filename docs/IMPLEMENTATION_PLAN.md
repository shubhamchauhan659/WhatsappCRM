# PaisaFollow — Implementation Plan & Checklist

PaisaFollow is a receivables follow-up module built on top of this repository
(wacrm: Next.js 16 + Supabase, MIT). See `LICENSING.md` for why this codebase
was used instead of InvoiceShelf (AGPL-3.0, PHP/Laravel).

## Baseline (recorded before any change)

- Git: `main` clean, HEAD `34bce1a` (upstream ArnasDon/wacrm).
- Remotes after setup: `origin` = github.com/shubhamchauhan659/WhatsappCRM
  (your repo), `upstream` = github.com/ArnasDon/wacrm (for future security
  fixes: `git fetch upstream && git merge upstream/main`).
- Baseline tests: 55 of 135 test files failed to load because
  `vitest.config.ts` used `URL#pathname` (percent-encodes the space in
  "AI Projects Kiro"). Fixed with `fileURLToPath` → 135/135 files, 1509 tests pass.

## Design decisions (short form — details in ARCHITECTURE.md)

1. Customers = existing `contacts` rows. No duplicate customer entity.
2. New tables: `invoices`, `invoice_payments`, `follow_ups`, `audit_events`.
3. Money is stored as integer paise (`BIGINT`). No floats anywhere.
4. Invoice payment state is derived, never typed in: `paid_paise` /
   `credited_paise` are maintained by a trigger on `invoice_payments`;
   `outstanding_paise` is a generated column; a CHECK constraint makes
   over-payment impossible; payments are immutable (void + re-enter).
5. Tenant integrity at the database level: RLS via `is_account_member()` plus
   composite foreign keys `(account_id, id)` so a row can never point at
   another business's customer or invoice.
6. Overdue days, aging buckets, missed promises and the daily queue are
   computed at read time from "today in the business timezone" — no cron
   job is required for P0, so nothing can run twice.
7. Reminders: deterministic templates (English / Hinglish / Hindi × 3 tones),
   strict variable rendering, copy / WhatsApp click-to-chat (`wa.me`) / SMS /
   email links. Marked "sent" only after the user confirms. Idempotent via
   `client_ref`.

## Checklist

- [x] Discovery: repository, license, stack, tenancy, tests (see ARCHITECTURE.md)
- [x] Fix baseline test alias bug
- [ ] Migration `060_receivables.sql` + CI schema assertions
- [ ] PGlite migration + RLS isolation test (runs inside `npm test`)
- [ ] Pure domain libs + unit tests (money, dates, status, aging, queue,
      promises, reminders, CSV parse/export, import validation, phone)
- [ ] UI: overview, queue, invoices, invoice detail, customers, customer
      detail, follow-up history, import, reports; dialogs for invoice,
      payment, follow-up, reminder composer
- [ ] Settings → Business profile (timezone, address, UPI ID, GSTIN)
- [ ] Account deletion API + UI, data export
- [ ] Middleware / sidebar / header wiring, i18n keys (all 4 locale files)
- [ ] Docs: PRODUCT_REQUIREMENTS, ARCHITECTURE, SECURITY, LICENSING, COSTS,
      ZERO_COST_PLAYBOOK, PILOT_GUIDE, LOCAL_SETUP, PRODUCTION_CHECKLIST
- [ ] lint, typecheck, test, build
- [ ] Commit; push to `origin` (blocked: GitHub credentials — see below)

## Blockers needing the owner

- GitHub push: the macOS keychain holds an invalid GitHub credential and no SSH
  key exists. Fix once with a fine-grained token (Contents: read/write on
  WhatsappCRM) or `brew install gh && gh auth login`, then `git push -u origin main`.
- Kiro auto-approve: agents are not allowed to edit `~/.kiro/settings/`; add
  the `capability: all` rule yourself (see final report).
