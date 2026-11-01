# PaisaFollow — Costs and hosting guide

_Pricing checked 2026-10-31 on vendor pages (links below). Prices and free
tiers change without notice, so re-check before you commit. "Verified" means
read on the vendor's own page that day. "Estimate" means my arithmetic or
assumptions, never a quote._

## 1. Verified pricing (as of 2026-10-31)

| Service | Free tier | First paid step | Source |
|---|---|---|---|
| Supabase | 500 MB DB/project, 1 GB storage, 5 GB egress (+5 GB cached), 50k MAU, 2 active free projects. **Paused after 1 week of inactivity. No automatic backups.** | Pro **$25/mo**: 8 GB disk, 250 GB egress, 100 GB storage, daily backups (7 days), never paused | [pricing](https://supabase.com/pricing), [billing FAQ](https://supabase.com/docs/guides/platform/billing-faq) |
| Supabase Auth email (built-in SMTP) | **2 emails/hour per project**. Useless for real signups. | Custom SMTP (free options below) | [rate limits](https://supabase.com/docs/guides/auth/rate-limits) |
| Vercel Hobby | Free, but **personal, non-commercial use only** | Pro $20/mo per seat | [hobby](https://vercel.com/docs/accounts/plans/hobby), [pricing](https://vercel.com/pricing) |
| Cloudflare Workers | 100k requests/day, **10 ms CPU per request**, 5 cron triggers | Workers Paid ($5/mo minimum) | [limits](https://developers.cloudflare.com/workers/platform/limits/) |
| OpenNext for Cloudflare | `@opennextjs/cloudflare` 1.20.15 supports Next ≥16.4.1. **This repo pins 16.3.8.** | — | [npm](https://registry.npmjs.org/@opennextjs/cloudflare/latest) |
| Oracle Cloud Always Free | Ampere A1: 1,500 OCPU-h + 9,000 GB-h/month (≈ **2 OCPU / 12 GB**), 200 GB block storage, 10 TB egress; Mumbai and Hyderabad regions. Idle instances reclaimed (7-day p95 CPU, network and memory all < 20%). | Pay-as-you-go | [always free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) |
| Render free | Sleeps after 15 min (≈1 min cold start). Free Postgres **deleted after 30 days** + 14 grace. Blocks SMTP ports. | Paid instances | [render free](https://render.com/docs/free) |
| GitHub Actions | **Public repos: standard runners free.** Private: $12/mo of included compute (≈2,000 Linux min), 500 MB artifacts. Scheduled workflows disabled after 60 days of no activity in public repos. | Pay as you go | [billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) |
| Brevo | 300 emails/day | Paid plans | [Brevo help](https://help.brevo.com/hc/en-us/articles/8292912279954-Add-or-remove-emails-from-your-plan) |
| Resend | 3,000/month, 100/day | Paid plans | [pricing](https://resend.com/pricing) |
| Gmail (personal) | ~500 emails/day | Google Workspace | [Gmail limits](https://support.google.com/mail/answer/22839) |
| Cloudflare R2 | 10 GB-month, 1M Class A, 10M Class B ops, **free egress** | $/GB beyond | [R2 pricing](https://developers.cloudflare.com/r2/pricing/) |
| UptimeRobot | 50 monitors, 5-min interval; commercial use OK | Paid | [pricing](https://uptimerobot.com/pricing/) |
| Healthchecks.io | 20 checks | Paid | [pricing](https://healthchecks.io/pricing/) |
| Sentry | 5k errors/month, 1 user | Team plan | [pricing](https://sentry.io/pricing/) |
| Upstash Redis | 250 MB, 500k commands/month | Pay as you go | [pricing](https://upstash.com/docs/redis/overall/pricing) |
| WhatsApp Business Platform | Per-message pricing since 1 Jul 2025. Utility templates **free inside an open customer-service window**. Service replies: first 1,000/month per number free since 1 Oct 2026. India accounts must bill in INR by 31 Dec 2026. | Per message | [Meta pricing](https://developers.facebook.com/docs/whatsapp/pricing) |
| WhatsApp India rates | Marketing ≈ ₹0.86, utility ≈ ₹0.115 per message + 18% GST | — | **Unverified** (third-party pages; Meta's rate card not retrievable) |
| Cloudflare Workers AI | 10,000 Neurons/day free | $0.011 / 1k Neurons | [pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) |
| Gemini API free tier | Free, but **prompts may be used to improve Google products** (India included) | Paid tier | [terms](https://ai.google.dev/gemini-api/terms) |
| UPI (merchant MDR) | Zero MDR for payments ≤ ₹2,000. Since 15 Oct 2026, 0.4% (capped ₹300) on specified P2M payments above ₹2,000; merchants with ≤ ₹1 lakh/month UPI receipts exempt | — | [The Hindu](https://www.thehindu.com/business/npci-introduces-04-percent-mdr-charge-on-upi-payments-above-rs-2000-exempts-small-merchants-person-to-person-transfers/article71468913.ece) (news; NPCI circular not fetched) |
| Docker Desktop | Free for businesses under 250 employees **and** under $10M revenue (you qualify) | Subscription | [license](https://docs.docker.com/subscription/desktop-license/) |

## 2. Measured footprint (PGlite, migration 060)

One business with 200 customers, **1,000 invoices, 800 payments and 2,000
follow-ups** (each follow-up with a ~300-character message):

| Table | Size incl. indexes |
|---|---|
| invoices | 768 KB |
| invoice_payments | 312 KB |
| follow_ups | 1,384 KB |
| audit_events | 2,536 KB |
| **Total** | **≈ 4.9 MB** |

The browser snapshot for that business is ≈ 2.1 MB raw JSON (≈ 0.26 MB if
gzip-compressed). Message bodies are excluded from the snapshot and loaded on
demand.

## 3. Cost scenarios (all **estimates**)

Assumption: an "active business" adds ~1,000 invoices a year and opens the
app about once a day (≈ 5 snapshot loads per session with the 60-second
cache).

| | 10 businesses | 100 businesses | 1,000 businesses |
|---|---|---|---|
| DB size / year | ~50 MB (Free OK) | ~500 MB (**Free limit**) | ~5 GB (Pro 8 GB OK) |
| Snapshot egress / month | ~3 GB raw (Free 5 GB, borderline) | ~30 GB raw (**Pro needed**) | ~300 GB raw (Pro + overage, or optimise first) |
| Database | $0 (Supabase Free) | **$25** (Supabase Pro) | $25 + compute add-on + egress overage (estimate $50–150) |
| App hosting | $0 (Oracle Always Free VM) | $0 (same VM) | $0–$20 (VM is enough; add a second for HA) |
| Auth + reminder email | $0 (Brevo 300/day) | $0 | Brevo/Resend paid tier (estimate $15–25) |
| Backups | $0 (GitHub Actions + R2) | $0 (Pro has daily backups too) | $0–5 |
| Monitoring | $0 (UptimeRobot, Healthchecks, Sentry free) | $0 | $0–26 |
| WhatsApp API (P2, optional) | $0 (wa.me links) | $0 (wa.me links) | ~₹0.115 per utility reminder outside service windows (unverified) |
| AI (optional) | $0 (templates) | $0 | $0 unless you enable it |
| **Monthly total** | **$0** | **≈ $25** | **≈ $75–$230** |
| Domain (.in) | optional ~₹600–1,000/yr (estimate, check registrar) | same | same |

Cheapest egress win before 100 businesses: snapshot only open invoices plus
the last 180 days of history. Estimated 3–5× less egress for mature accounts.

## 4. Free-tier limitations to plan around

1. **Supabase Free pauses after 7 days idle and has no backups.** Run
   `.github/workflows/backup.yml`. Put the **first paying customer on Pro**.
2. **Built-in auth email is 2/hour.** Configure Brevo or Resend SMTP before
   inviting anyone (Supabase → Authentication → SMTP).
3. **Vercel Hobby is non-commercial.** Use it only for a private demo.
4. **Cloudflare Workers Free (10 ms CPU)** is too tight for Next.js SSR, and
   OpenNext needs Next ≥ 16.4.1. So it's not a $0 option for this app today.
5. **Render free** deletes Postgres after 30 days. Never put real data there.
6. **Oracle Always Free** may reclaim an idle VM. Keep your Docker image and
   backups so you can recreate it in an hour. Consider upgrading the tenancy
   to pay-as-you-go while staying inside Always Free limits (reportedly
   avoids idle reclamation; **unverified**, check Oracle's current FAQ).
7. **GitHub scheduled workflows** in a public repo stop after 60 days with no
   commits. Push something, or re-enable from the Actions tab.

## 5. Migration options when you outgrow free

Supabase Free → Supabase Pro (same project, no code change) → bigger compute
add-on. Oracle VM → second VM behind Cloudflare load balancing, or a managed
Node host (Vercel Pro, Railway, Hostinger Node). The app is a standard
Next.js standalone build plus a Dockerfile, so any Node 22 host works.
