# PaisaFollow — receivables follow-up for Indian small businesses

> Every morning, know whom to contact, how much is overdue, what the customer
> promised, and what to do next.

PaisaFollow helps wholesalers, distributors and traders who sell on credit
chase overdue invoices without spreadsheets. It runs on free tiers, needs no
paid API, and works with WhatsApp through the owner's own app.

It is built on [wacrm](https://github.com/ArnasDon/wacrm) (MIT), a Next.js 16
+ Supabase WhatsApp CRM. The full CRM (shared inbox, contacts, pipelines,
broadcasts, automations, AI assistant) is still included.

## What it does

- **Today's follow-up queue**: customers ranked by fixed, explained rules
  (days overdue, amount, missed promises, scheduled follow-ups). Disputes are
  listed separately.
- **Receivables dashboard**: total outstanding and overdue, ageing 1–7 /
  8–30 / 31+ days, top overdue customers, promises due or missed, overdue
  with no follow-up, recent payments.
- **Invoices and payments**: partial payments, credit notes, void-not-delete,
  cancellation. Balances are derived from payments only and enforced by the
  database.
- **Follow-ups and promises to pay**: channel, outcome, next date, promised
  date and amount, dispute reason. Missed promises resurface automatically.
- **Reminder drafts**: English, Hinglish and Hindi × polite / standard /
  firm. Variable preview and a wrong-amount check. Send by copy, WhatsApp
  (`wa.me`), SMS or email. Recorded as sent only when you confirm.
- **CSV import** from Tally / Busy / Vyapar / Excel with row-level errors and
  duplicate flags. **CSV exports** with formula-injection protection.
- **Business profile** (timezone, GSTIN, UPI ID), audit trail, data export,
  owner account deletion.

## Quick start

```bash
npm ci
cp .env.local.example .env.local     # Supabase URL + keys, ENCRYPTION_KEY, META_APP_SECRET
# apply supabase/migrations/*.sql to your Supabase project (see docs/LOCAL_SETUP.md)
npm run dev                          # http://localhost:3000 → sign up → Receivables
```

```bash
npm test                 # unit + database tests (PGlite: all migrations, RLS isolation) — no Docker needed
npm run build && npm run test:smoke
```

## Documentation

| Doc | What's inside |
|---|---|
| [docs/ZERO_COST_PLAYBOOK.md](docs/ZERO_COST_PLAYBOOK.md) | How to run everything for ₹0, and what not to do |
| [docs/COSTS.md](docs/COSTS.md) | Verified pricing (2026-10-31), measured footprint, 10/100/1000-business estimates |
| [docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md) | Setup, env vars, migrations, demo seed, backup/restore, troubleshooting |
| [docs/PILOT_GUIDE.md](docs/PILOT_GUIDE.md) | Guide for pilot businesses |
| [docs/PRODUCT_REQUIREMENTS.md](docs/PRODUCT_REQUIREMENTS.md) | Scope, P0/P1/P2, acceptance criteria |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Feature reuse matrix, data model, invariants, upstream modification inventory |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model, controls, residual risks |
| [docs/LICENSING.md](docs/LICENSING.md) | Why wacrm (MIT) and not InvoiceShelf (AGPL-3.0); dependency audit |
| [docs/PRODUCTION_CHECKLIST.md](docs/PRODUCTION_CHECKLIST.md) | Pilot readiness, blockers |
| [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) | Checklist, test results, known limitations |

The original wacrm docs (WhatsApp setup, public API, MCP, Docker, auth
emails) are still in `docs/`.

## Upstream updates

```bash
git fetch upstream && git merge upstream/main   # upstream = ArnasDon/wacrm
```

See the "Upstream modification inventory" in `docs/ARCHITECTURE.md` for the
files to re-check.

## License

wacrm is MIT-licensed © 2026 Arnas Donauskas (see `LICENSE`). Read
`docs/LICENSING.md` §2 before treating the PaisaFollow additions as
proprietary: this repository is public.
