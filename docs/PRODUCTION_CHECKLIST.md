# Pilot readiness checklist (Phase D)

✅ done in the code · ⚠️ needs you (credentials, accounts or decisions) · ⛔ blocker until done

| Area | Item | Status |
|---|---|---|
| Source | Code pushed to `github.com/shubhamchauhan659/WhatsappCRM` | ⛔ GitHub credentials needed on this machine (see README "Push") |
| Licensing | Decide open source vs proprietary for the public repo (`LICENSING.md` §2) | ⚠️ |
| Licensing | Keep wacrm MIT `LICENSE`. Add LGPL notices if you distribute Docker images. | ✅ / ⚠️ |
| HTTPS | TLS terminated by Caddy / Cloudflare / host. HSTS header already set by the app. | ⚠️ |
| Secrets | All secrets in server env / GitHub secrets. `.env*` git-ignored. Service role only server-side. | ✅ |
| Secrets | Generate a fresh `ENCRYPTION_KEY` for production, and store it in a password manager | ⚠️ |
| Database isolation | RLS + composite FK isolation tests pass (`npm test`) | ✅ |
| Database | Migrations 001–060 applied to the production project, in the **Mumbai** region | ⚠️ |
| Persistent storage | Supabase (not a free host's disk). Logo is a URL, not an upload. | ✅ |
| Backups | `backup.yml` secrets configured (DB URL, passphrase, R2). First run green. | ⚠️ |
| Backups | Restore drill done into a scratch project. Drift check = 0. | ⚠️ |
| Monitoring | UptimeRobot on `/login`. Healthchecks.io on the backup job. Optional Sentry. | ⚠️ |
| Error handling | Generic user messages, retry buttons, server-side logging | ✅ |
| Rate limits | Account deletion limited. Supabase Auth rate limits on. Custom SMTP configured. | ✅ / ⚠️ |
| Auth email | Custom SMTP (Brevo/Resend). Site URL and redirect URLs set. | ⛔ (built-in sender allows 2/hour) |
| Data deletion | Owner self-service deletion plus CSV export | ✅ |
| Terms and privacy | Terms of Service, Privacy Policy, data-processing terms for businesses (DPDP Act). Support email in `.github/SECURITY.md`. | ⛔ |
| Notification consent | Reminders are user-sent from their own apps. The pilot guide covers etiquette. WhatsApp API opt-in is required only for P2. | ✅ |
| Support and incidents | A support channel (WhatsApp number / email). Incident steps: rotate keys, restore from backup, notify affected businesses. | ⚠️ |
| Upstream | `upstream` remote set. Monthly `git fetch upstream` for security fixes. | ✅ |
| Free-tier risk | First paying customer goes on Supabase Pro (backups, no pausing) | ⚠️ |

**Do not open public signups** until every ⛔ is cleared and the isolation
tests pass against the production database. To run them against production:
replay `supabase/ci/verify-schema.sql` there, then try a two-account manual
check.
