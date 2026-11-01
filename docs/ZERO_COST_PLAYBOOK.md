# Zero-cost playbook — running PaisaFollow for ₹0

You asked for every legitimate way to run this for free, including the ones
most people miss. The rule I held to is that **free should come from design,
not from breaking a provider's terms**. Tricks that risk your account or your
customers' data are listed at the end as "don't".

Verified numbers and sources are in `COSTS.md`.

## Part 1 — Already built into the code (cost ₹0 forever)

| Hack | What it replaces | Why it's free |
|---|---|---|
| **Read-time computation**: overdue, ageing, missed promises and the queue are computed from dates when the page opens | Cron jobs, queues, workers | Nothing runs when nobody is looking; a missed promise appears the next morning with no scheduler |
| **WhatsApp click-to-chat (`wa.me`)**: the owner's own WhatsApp / WhatsApp Business app opens with the reminder pre-filled | WhatsApp Business Platform (paid per template message) | Official WhatsApp feature, no API, no Meta account, no per-message fee |
| **UPI ID inside the reminder** | Payment gateway (~2%) / payment links | Customer pays the business's VPA directly: zero MDR up to ₹2,000; merchants under ₹1 lakh/month UPI receipts are exempt above that too (see COSTS.md) |
| **SMS / email via `sms:` / `mailto:` links** | SMS gateway, email API | Uses the owner's own SIM plan and mailbox |
| **Deterministic Hindi / Hinglish / English templates** | LLM API | No tokens, no latency, no data leaving your database |
| **CSV import from Tally / Busy / Vyapar / Excel** | Accounting integrations | Every Indian accounting tool exports Excel/CSV |
| **Database-enforced invariants** (RLS, triggers, CHECKs) | Separate backend / API servers | The browser talks to Postgres safely through Supabase; one app, one DB |
| **PGlite tests**: real Postgres in WebAssembly inside `npm test` | Docker + local Supabase for testing | All 54 migrations plus RLS isolation tested on any laptop or CI runner |
| **60-second snapshot cache; message bodies loaded on demand** | Bigger Supabase plan | Cuts egress, which is the first free limit you'll hit |
| **Idempotent `client_ref`** | Message queues / dedup services | Retries and double taps can't create duplicates |

## Part 2 — The ₹0 production stack (recommended for the pilot)

```
Customer's phone ──HTTPS──► Cloudflare (free DNS, proxy, TLS) ──► Oracle Always Free ARM VM
                                                                  (Docker: Next.js app + Caddy)
                                                                          │
                                                       Supabase Free (Mumbai) — Postgres + Auth
                                                                          │
                     GitHub Actions (public repo = free) ── nightly encrypted pg_dump ──► Cloudflare R2 (10 GB free)
                     Brevo SMTP (300/day free) ◄── auth emails
                     UptimeRobot + Healthchecks.io + Sentry (free tiers) ── monitoring
```

### Step by step

1. **Database**: create a Supabase project in **Mumbai (ap-south-1)**. Apply
   `supabase/migrations/*.sql` in order (see `LOCAL_SETUP.md`).
2. **Auth email**: create a free Brevo account, verify your sender, and paste
   its SMTP credentials into Supabase → Authentication → SMTP. This fixes the
   built-in 2 emails/hour limit.
3. **Server**: sign up for Oracle Cloud with home region **Mumbai or
   Hyderabad**. Always Free VMs exist only in your home region, so choose it
   once, correctly. Create an Ampere A1 VM (2 OCPU / 12 GB fits easily), then:
   ```bash
   sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git
   git clone https://github.com/shubhamchauhan659/WhatsappCRM.git && cd WhatsappCRM
   cp .env.local.example .env.local   # fill in Supabase URL/keys, ENCRYPTION_KEY, META_APP_SECRET, NEXT_PUBLIC_SITE_URL
   sudo docker compose up -d --build  # app on :3000
   ```
   Put **Caddy** in front for automatic HTTPS (`caddy reverse-proxy --from
   app.yourdomain.in --to :3000`). Open ports 80/443 in the VM's security
   list.
4. **Domain**: point a Cloudflare-managed domain at the VM (proxied, free
   TLS). Until you buy one, a free dynamic-DNS subdomain works for a pilot.
5. **Backups**: add `SUPABASE_DB_URL`, `BACKUP_PASSPHRASE` and the four `R2_*`
   secrets to the GitHub repo. `.github/workflows/backup.yml` then runs
   nightly. Restore is tested (`scripts/restore.sh`). Because the repo is
   public, the workflow never uploads backups as artifacts.
6. **Monitoring**: an UptimeRobot HTTP monitor on `/login`, a Healthchecks.io
   check pinged at the end of the backup job, and optionally Sentry.

**Cost: ₹0/month.** Your only spend is an optional `.in` domain.

### Alternative free hosts, compared honestly

| Option | Verdict |
|---|---|
| **Oracle Always Free ARM VM** | ✅ Best ₹0 option: real server, India region, 10 TB egress. Risk: idle reclamation. Keep backups and the one-command redeploy above. |
| Your own laptop / old PC + **Cloudflare Tunnel** | ✅ ₹0, no open ports, good for 2–3 friendly pilot businesses. Risks: power, ISP, laptop sleep. |
| Vercel Hobby | ❌ For paying customers, the terms say non-commercial only. Fine for a private demo. |
| Cloudflare Workers (OpenNext) | ⏳ Needs Next ≥ 16.4.1 and probably Workers Paid ($5) for SSR CPU. Revisit after upgrading Next. |
| Render free | ❌ Sleeps (1-min cold starts), and free Postgres is deleted after 30 days. |
| Supabase alone (no app host) | ❌ Next.js still needs a Node runtime. |

## Part 3 — Free channels most people miss

| Need | ₹0 approach |
|---|---|
| Daily summary to the **owner** (P1) | **Telegram bot** (Bot API is free), or **web push** to the installed PWA (free; iPhone needs iOS 16.4+ and "Add to Home Screen") |
| Bulk "statement" to many customers | WhatsApp Business **app** broadcast lists from the owner's phone. Only reaches customers who saved the business number. Free, but keep it relevant: no spam. |
| Customer pays without a gateway | UPI ID in the reminder (built in). Later, a UPI QR on a public pay page. |
| App store presence | Install as a **PWA** ("Add to Home screen") with no store fee. Wrap with a Trusted Web Activity only if you need the Play Store (one-time developer fee). |
| Local dev without paid Docker | Docker Desktop is free for you (< 250 staff and < $10M revenue). Colima (MIT) also works. Tests don't need Docker at all (PGlite). |
| CI | Public repo, so standard GitHub runners are free. Existing workflows already lint, typecheck, test (including DB tests) and replay migrations on real Supabase Postgres. |
| AI (only if ever needed) | Templates first. Then Cloudflare Workers AI (10k Neurons/day free) or a local Ollama model. **Never** the Gemini free tier with customer data: it's used for training. |
| Error tracking / uptime | Sentry Developer (5k errors), UptimeRobot (50 monitors), Healthchecks.io (20 checks) |
| Collecting your own SaaS fees later | UPI to your own VPA: plans under ₹2,000 per payment carry zero MDR. Use Razorpay/Cashfree subscriptions only when you need auto-renewal. |

## Part 4 — Free distribution (getting the first 10 users)

- **Chartered accountants and tax consultants**: each serves dozens of
  traders who struggle with collections. Offer the CA a free dashboard for
  their clients.
- **Trade association WhatsApp groups** (electrical, hardware, building
  material markets). A 60-second Hindi screen recording of "Today's list →
  WhatsApp reminder → payment recorded" is more convincing than a website.
- **Tally users**: "export your outstanding report, import in 2 minutes" is
  the onboarding pitch. The sample CSV is on the Import page.
- **Google Business Profile** and short Hindi YouTube/Instagram demos are
  free and searchable.

## Part 5 — When to start paying (so free never becomes risky)

| Trigger | Action | Cost |
|---|---|---|
| First paying customer, or any data you can't lose | Supabase Pro (daily backups, never paused) | $25/mo |
| More than 5 GB/month egress, or DB near 400 MB | Slim the snapshot (open + last 180 days), then Pro | $0 → $25 |
| More than 300 auth/reminder emails a day | Paid Brevo/Resend | ~$15–25/mo (estimate) |
| Customers want automatic WhatsApp reminders | WhatsApp Business Platform (base code exists) | per message |

## Part 6 — Don't (these "hacks" cost more than they save)

- ❌ **Unofficial WhatsApp Web automation** (whatsapp-web.js, Baileys, Selenium):
  number bans, a terms violation, and your customers' chats exposed.
- ❌ **Several free accounts to multiply quotas** (Supabase projects, Oracle
  tenancies, email providers). It breaks the terms, can get every account
  closed together, and spreads customer data around.
- ❌ **Fake load to dodge idle reclamation** or keep-alive scripts meant to
  defeat a provider's limits. Real usage keeps things alive; paying
  customers go on paid tiers.
- ❌ **Real customer data on throwaway free databases** (Render free Postgres,
  unverified hosts).
- ❌ **Backups as artifacts in a public repo**, even "encrypted". The workflow
  refuses this.
- ❌ **Free AI tiers that train on inputs** for anything containing customer
  names, phones or amounts.
