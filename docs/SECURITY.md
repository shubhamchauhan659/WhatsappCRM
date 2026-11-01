# PaisaFollow — Security, threat model and residual risks

Scope: the receivables module and the parts of wacrm it relies on. The
pre-existing wacrm security docs (`.github/SECURITY.md`, HMAC webhooks,
token encryption) still apply.

## 1. Assets

| Asset | Sensitivity |
|---|---|
| Customers' names, phones, emails, outstanding amounts, disputes, internal notes | Personal and commercial data (India DPDP Act) |
| Payment records and audit trail | Integrity-critical: a false "paid" costs real money |
| Supabase service-role key, ENCRYPTION_KEY, META_APP_SECRET | Full database access / token decryption |
| Owner accounts | Takeover gives the business's whole ledger |

## 2. Threats and mitigations

| # | Threat | Mitigation | Verified by |
|---|---|---|---|
| T1 | Business A reads or edits business B's data | RLS on all 4 new tables via `is_account_member`; anon role has no grants | `receivables-db.test.ts` › business isolation (8 tests) |
| T2 | A guessed UUID links A's row to B's customer or invoice (FK checks bypass RLS) | Composite FKs `(account_id, contact_id)` / `(account_id, invoice_id)` | same |
| T3 | Client marks an invoice paid without money | Totals are trigger-owned; insert forces 0; client edits raise `42501` | db tests |
| T4 | Over-payment, or concurrent double payment | CHECK constraint plus row-lock-serialised increments | db test |
| T5 | History tampering (edit or delete payments) | Payments immutable, void only, no DELETE policy; `audit_events` append-only | db tests |
| T6 | Retries / double taps create duplicates | `client_ref` unique per account; invoice number unique per business (case-insensitive) | db tests |
| T7 | Invite redemption deletes an account that holds receivables | `redeem_invitation` checks the new tables | migration test + db test |
| T8 | Spreadsheet formula injection via exported CSV | `escapeCsvText` prefixes `= + - @ \t \r` with `'` | `csv.test.ts` |
| T9 | XSS via customer names, notes or messages | React escaping; no `dangerouslySetInnerHTML` in new code; messages shown as text | code review |
| T10 | PostgREST filter injection in customer search | Search term stripped of `% , ( ) * \ "` before the `or()` filter | code review |
| T11 | Malicious or huge CSV | Parsed in the browser as text; 5 MB and 5,000-row caps; never stored or executed | `import` tests |
| T12 | Wrong amount sent to a customer | Variables built from stored balances only; unexpected-amount warning; missing/unknown placeholders block sending | `reminders-import.test.ts` |
| T13 | Harassing or threatening reminders | Templates professional only; banned-term test (legal/police/court/defaulter…) | same |
| T14 | Account deletion abuse or CSRF | Owner only; typed business name; sole member; 3/hour rate limit; SameSite=Lax cookies plus JSON body (needs CORS preflight) | `route.delete.test.ts`, smoke test (anon → 401) |
| T15 | Secret leakage | Secrets only in server env; service role used only in server routes; `.env*` git-ignored; backups encrypted (AES-256, PBKDF2) | `.gitignore`, `scripts/backup.sh` |
| T16 | Unauthenticated access to pages | Middleware redirects every `/receivables/*` to `/login` | `middleware.test.ts`, smoke test |
| T17 | Viewer-role member edits data | RLS writes need `agent`; UI disables controls | db test (viewer) |

## 3. Controls checklist

- [x] Authentication: Supabase Auth (existing). Sessions in `@supabase/ssr` cookies.
- [x] Authorisation: RLS on every table; role tiers viewer < agent < admin < owner.
- [x] Business-level isolation tests run in `npm test` (PGlite, real Postgres).
- [x] Input validation: client validators plus database CHECK constraints (lengths, formats, ranges, GSTIN, UPI, timezone).
- [x] CSV formula-injection protection on every export.
- [x] CSRF: no state-changing GET; cookie SameSite=Lax; JSON APIs.
- [x] XSS / injection: escaped rendering; parameterised PostgREST; sanitised search.
- [x] Rate limiting on the new sensitive endpoint (`DELETE /api/account`).
- [x] Audit log for invoices, payments (incl. voids) and follow-ups.
- [x] Safe errors: generic messages to users; details only in server logs.
- [x] Data export (Reports → CSV) and deletion (Settings → Business profile).
- [x] Backup and restore scripts tested end to end on local Postgres (encryption, integrity check, wrong passphrase rejected, non-empty target refused).
- [ ] **You:** enable MFA for your own Supabase, GitHub and hosting accounts.
- [ ] **You:** configure custom SMTP (the built-in sender allows 2 emails/hour).

## 4. Residual risks (accepted for pilot, fix before scaling)

1. **CSP is report-only** (inherited from wacrm `next.config.ts`). It doesn't
   block injected scripts yet. Move to enforcing once reports are clean.
2. **Rate limiter is in-memory per instance.** Fine for one server; use
   Upstash/Redis or a Postgres limiter for multiple instances.
3. **Direct PostgREST writes** (invoice, payment, follow-up) are not
   app-rate-limited. Integrity holds (DB constraints), but a malicious
   *member* could flood their own account. Supabase's API limits apply.
4. **Viewers can read internal notes and the audit log** of their own
   business. Acceptable for small teams; add column-level restrictions if
   needed.
5. **Agents can delete follow-ups.** Deletion is recorded in `audit_events`,
   but the row is gone from history.
6. **Full snapshot in the browser.** Every authorised member downloads all of
   the business's receivables data. Fine for SMB sizes; see ARCHITECTURE.md §6.
7. **Storage cleanup on deletion is best-effort.** Media in nested folders
   beyond 5,000 objects may remain; run a manual sweep if an account had heavy
   WhatsApp media.
8. **Inherited wacrm surface** (WhatsApp webhook, public API keys, AI keys)
   is enabled even if you never use it. Leave `META_APP_SECRET` set (the
   webhook rejects unsigned calls) and don't create API keys you don't need.
9. **Public GitHub repository.** Never commit `.env.local`, customer exports
   or backups. The backup workflow refuses to upload artifacts from a public
   repo.
10. **No MFA for app users yet.** Supabase supports TOTP MFA, but the UI isn't
    wired. Recommend strong passwords; add MFA in P1.

## 5. Reporting a vulnerability

Email the owner (set a real address in `.github/SECURITY.md` before launch)
and don't open a public issue.
