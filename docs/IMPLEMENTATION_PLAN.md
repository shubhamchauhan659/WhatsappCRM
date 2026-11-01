# PaisaFollow — Implementation plan and completed checklist

PaisaFollow is a receivables follow-up module built on this repository
(wacrm: Next.js 16 + Supabase, MIT). See `LICENSING.md` for why this codebase
was used instead of InvoiceShelf (AGPL-3.0, PHP/Laravel).

## Baseline (recorded before any change)

- Git: `main` clean at `34bce1a` (upstream ArnasDon/wacrm).
- Remotes after setup: `origin` = github.com/shubhamchauhan659/WhatsappCRM
  (your repo); `upstream` = github.com/ArnasDon/wacrm (for security fixes).
  Your repo's initial README commit was joined with `merge -s ours`. No force
  push, no rewritten history.
- Baseline tests: **55 of 135 test files failed to load.** `vitest.config.ts`
  used `URL#pathname`, which percent-encodes the space in "AI Projects Kiro".
  Fixed with `fileURLToPath`: 135/135 files, 1,509 tests pass.

## Phase checklist

### A — Discovery
- [x] Repository, stack, tenancy/RLS model, auth, routes, tests and tooling inspected
- [x] Licensing analysis: InvoiceShelf AGPL-3.0 vs wacrm MIT; dependency audit (`LICENSING.md`)
- [x] Feature reuse matrix (`ARCHITECTURE.md` §1)
- [x] PRD, architecture, security, licensing, costs documents

### B — MVP
- [x] Business setup and isolation: migration 060 business profile, INR default, RLS + composite FKs
- [x] Receivables dashboard (`/receivables`)
- [x] Follow-up history and promise tracking (`follow_ups`, `promises.ts`)
- [x] Daily follow-up queue with explained, deterministic scoring (`/receivables/queue`)
- [x] Reminder drafts (en / Hinglish / Hindi × 3 tones), clipboard, `wa.me` / SMS / email, confirm-to-record
- [x] CSV invoice import (row-level errors, duplicate flags) and CSV exports (formula-injection safe)
- [x] Audit log (triggers), tests, smoke test

### C — Local deployment
- [x] Env documentation (`.env.local.example`, `LOCAL_SETUP.md`). No new variables required.
- [x] Docker: existing `Dockerfile` / `docker-compose.yml` unchanged and compatible
- [x] Migrations (`060_receivables.sql`) + CI schema assertions
- [x] Demo seed (`scripts/seed-demo.sql`, idempotent, tested)
- [x] Backup / restore scripts (tested end to end) + nightly workflow
- [x] Troubleshooting guide
- [ ] Clean install from a fresh checkout **against a real Supabase project**. Needs your Supabase credentials. Everything that doesn't need them was verified (below).

### D — Pilot readiness
- [x] `PRODUCTION_CHECKLIST.md` (⛔ items: GitHub push credentials, custom SMTP, Terms/Privacy)

### E — Monetisation readiness
- [x] Plan structure and server-side entitlement design documented (no billing code, by design)

## Verification (commands actually run, 2026-10-31)

| Check | Result |
|---|---|
| `npm test` (vitest) | **142 files, 1,669 tests passed.** 1,509 pre-existing + 160 new, of which 35 run on real Postgres via PGlite with all 54 migrations replayed. |
| `npm run typecheck` | pass |
| `npm run lint` | 0 errors (warnings only; none from new code) |
| `npm run build` | pass. 9 new routes under `/receivables`. |
| `npm run test:smoke` (production build over HTTP) | 14/14 checks: app boots, security headers, every receivables page redirects anonymous users to `/login`, anonymous `DELETE /api/account` → 401 |
| `scripts/backup.sh` → `scripts/restore.sh` on local Postgres 14 | balances identical after restore; drift check 0; wrong passphrase rejected; non-empty target refused |
| CI `verify-schema.sql` | passes on the migrated PGlite DB and fails when a 060 policy is sabotaged |

Not verified here (needs your accounts): applying migrations to a hosted
Supabase project, real signup email delivery, and the GitHub Actions runs.
The migrations workflow will replay all migrations on real Supabase
Postgres 17 once pushed.

### Spec acceptance tests → where they are

| Requirement (brief §11) | Test |
|---|---|
| Paid invoice not overdue | `ledger-logic.test.ts` › "a paid invoice is not overdue"; demo seed test |
| Partial payments → correct outstanding | `ledger-logic.test.ts` + `receivables-db.test.ts` (DB-enforced) |
| Overdue invoice appears in queue | `ledger-logic.test.ts` › daily follow-up queue |
| Promise recorded correctly | `receivables-db.test.ts` › "records a promise to pay" |
| Missed promise surfaced after its date | `ledger-logic.test.ts` › pending → due today → missed; queue resurfaces even when snoozed |
| Repeated execution doesn't duplicate reminders | `receivables-db.test.ts` › client_ref idempotency (payments + "reminder sent"); queue idempotence |
| CSV import: malformed rows and duplicates | `reminders-import.test.ts` › invoice CSV import |
| Business A can't read B | `receivables-db.test.ts` › business isolation (8 tests) |
| Failed notification not marked delivered | By design: nothing is marked sent without explicit user confirmation, and nothing is ever marked "delivered" (no provider integration in P0). The P2 rule is documented in ARCHITECTURE §7. |
| Reminder variables can't silently use wrong amounts | `reminders-import.test.ts` › variables use outstanding not total; paid invoices refused; missing values visible; unexpected-amount detection |
| Exports don't execute formulas | `csv.test.ts` |
| Data deletion and backup restore | `route.delete.test.ts`; `receivables-db.test.ts` › deletion cascade, deletion order, backup/restore; script round trip above |

## Known limitations / deferred

- Reminders are sent manually through the user's own apps (P0 by design).
  Email automation, daily summaries and WhatsApp Platform sending are P1/P2.
- UI strings are English. es/ko/pt catalogues carry English copies of the new
  keys, and a Hindi UI catalogue is P1. Reminder *messages* support Hindi and
  Hinglish.
- The client loads a per-business snapshot. That's fine to a few thousand
  invoices; the scale-out path is in ARCHITECTURE §6.
- Invoice ↔ customer can't be changed after creation (cancel and re-create).
- Logo is a URL field, not an upload.
- CSP is still report-only (inherited). The rate limiter is per instance.
  See SECURITY §4.
- `next` is pinned at 16.3.8. The Cloudflare Workers adapter needs ≥ 16.4.1.

## Blockers that need you

1. **GitHub push.** The keychain credential for github.com is invalid and
   there is no SSH key. Fix once with a fine-grained token (Contents
   read/write on WhatsappCRM), or `brew install gh && gh auth login`, then
   `git push -u origin main`.
2. **Kiro auto-approve.** Agents may not edit `~/.kiro/settings/`. Add the
   `capability: all` rule yourself (see the final report).
3. **Supabase project + custom SMTP + Terms/Privacy** before inviting real
   businesses (`PRODUCTION_CHECKLIST.md`).
