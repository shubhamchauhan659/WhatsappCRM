# Local setup, deployment, backup and troubleshooting

## 1. Prerequisites

- **Node 22 LTS** (repo `engines`: `>=22.12`). Node 23 also works but prints
  `EBADENGINE` warnings.
- A free **Supabase** project (region **Mumbai**) for the dev database and auth.
- Optional: Docker (for the container image), PostgreSQL client tools 17 (for
  backups).

## 2. One-time setup

```bash
git clone https://github.com/shubhamchauhan659/WhatsappCRM.git paisafollow
cd paisafollow
npm ci
cp .env.local.example .env.local
```

Fill `.env.local`. Names only; never commit this file. It is git-ignored.

| Variable | Required | Where to get it |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | yes (server only) | same page. **Secret**: needed for account deletion, webhooks and the public API. |
| `ENCRYPTION_KEY` | yes | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `META_APP_SECRET` | yes (any non-empty value if you don't use WhatsApp API) | Meta app settings, or a random string |
| `NEXT_PUBLIC_SITE_URL` | recommended | e.g. `http://localhost:3000` |
| `NEXT_PUBLIC_APP_LOCALE` | optional | `en` (default) |

PaisaFollow adds **no new environment variables**. Backup secrets live in
GitHub Actions secrets, not in the app.

### Apply the database migrations

Pick one:

- **Supabase CLI**: `npx supabase@2.113.0 link --project-ref <ref>` then
  `npx supabase@2.113.0 db push` (applies `supabase/migrations/*` in order).
- **SQL editor**: paste each file from `supabase/migrations/` **in filename
  order** (001 … 060) and run it. They are idempotent.

Then in Supabase → Authentication:
- **URL configuration**: set Site URL and redirect URLs to your app URL (see
  `docs/auth-emails.md`).
- **SMTP**: add Brevo/Resend credentials. The built-in sender allows only
  2 emails/hour.

## 3. Run

```bash
npm run dev            # http://localhost:3000 → sign up → /receivables
```

One-command container run (uses `.env.local`):

```bash
docker compose up --build      # http://localhost:3000
```

### Demo data (development or explicit demo environments only)

Sign up once, then:

```bash
psql "$SUPABASE_DB_URL" -v account_email='you@example.com' -f scripts/seed-demo.sql
```

This creates 6 "DEMO …" customers with invoices in every ageing bucket,
partial payments, a credit note, kept and missed promises, and a dispute.
Removal SQL is at the bottom of the file. Never run it against a database
holding real customers.

## 4. Tests

```bash
npm test              # 142 files: unit tests + PGlite DB tests (all 54 migrations, RLS isolation)
npm run lint && npm run typecheck
npm run build && npm run test:smoke   # boots the production build; checks auth protection over HTTP
```

None of these need Docker, a Supabase project or network access.

## 5. Backup and restore

```bash
# backup (encrypted, integrity-checked)
SUPABASE_DB_URL='postgresql://…' BACKUP_PASSPHRASE='…' scripts/backup.sh backups/

# restore into a NEW project that already has all migrations applied
TARGET_DB_URL='postgresql://…' BACKUP_PASSPHRASE='…' scripts/restore.sh backups/paisafollow-<stamp>.dump.enc
```

`restore.sh` restores data only, with triggers disabled, so invoice totals are
not double counted. It refuses a non-empty target and prints a drift check
(`invoices_with_drift` must be 0). Nightly automation:
`.github/workflows/backup.yml` (see the comments at its top for the secrets).

**Restore drill**: do this once before your first customer, and record the
time it took.

## 6. Deploy

See `docs/ZERO_COST_PLAYBOOK.md` Part 2 (Oracle Always Free + Caddy +
Cloudflare) and `docs/docker.md`. Any Node 22 host that runs `npm run build &&
npm start`, or the Dockerfile, works.

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| Tests fail with `Cannot find package '@app-messages'` | Fixed in `vitest.config.ts` (paths with spaces). Pull the latest main. |
| "Could not load your receivables" with `relation "invoices" does not exist` | Migration 060 not applied. Run it (or `db push`). |
| Signup or password-reset emails never arrive | Built-in SMTP limit (2/hour). Configure custom SMTP. Check the redirect URLs. |
| Confirmation link goes to `localhost:3000` | Supabase → Auth → URL configuration (see `docs/auth-emails.md`). |
| "new row violates row-level security" | The user's role is `viewer`. An owner or admin changes it in Settings → Team members. |
| Overdue counts look one day off | Set the business timezone in Settings → Business profile. "Today" uses it, not the device clock. |
| Invoice can't be cancelled | It has payments or credit notes. Void them first, or keep it open. |
| Customer can't be deleted from Contacts | They have invoices (financial records are protected). Cancel or keep the invoices. |
| CSV columns not recognised | Rename headers to `Customer, Phone, Invoice No, Invoice Date, Due Date, Amount, Paid Amount`, or download the sample CSV. |
| Backup workflow fails "repository is public" | Add the `R2_*` secrets (or make the repo private). Backups are never uploaded as public artifacts. |
