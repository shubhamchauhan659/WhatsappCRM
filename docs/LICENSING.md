# Licensing review — PaisaFollow

_Reviewed 2026-10-31. This is an engineering review, not legal advice — have
a lawyer confirm before you charge customers._

## 1. Decision: why PaisaFollow is built on wacrm, not InvoiceShelf

| | InvoiceShelf (requested foundation) | wacrm (this repository) |
|---|---|---|
| License | **GNU AGPL-3.0** — verified from the repository's `LICENSE` file ([source](https://github.com/InvoiceShelf/InvoiceShelf/blob/master/LICENSE)) | **MIT**, © 2026 Arnas Donauskas — `LICENSE` in this repo |
| Hosted-SaaS consequence | AGPL §13: if you run a *modified* version as a network service, you must offer every user the complete corresponding source of your modified version under the AGPL. A proprietary hosted product on modified InvoiceShelf is not possible. | Use, modify, host and sell freely; keep the MIT copyright + permission notice. |
| Stack | PHP / Laravel + Vue (needs PHP hosting, a queue worker and cron for its scheduler) | Next.js 16 + Supabase (Postgres, Auth, RLS) — runs on free tiers |
| Status | README says the stable v2 line gets security patches only until 2027-09-01; new work goes into v3 | Actively maintained template |
| Already has | Invoices, estimates, payments, expenses, reports | Multi-tenant accounts + roles, contacts, CSV import, WhatsApp Cloud API, BYO-key AI, i18n |

The workspace you gave me is wacrm, and your target repository is called
`WhatsappCRM`. So I followed the brief's own fallback: _"build an independent
implementation using clean-room requirements and appropriately licensed
dependencies"_.

**Clean-room statement.** No InvoiceShelf source code was copied, translated
or used as a reference. Only its public README and LICENSE were read, to
establish the license and stack. The receivables module (invoices, payments,
follow-ups, ageing) was written from the requirements in
`PRODUCT_REQUIREMENTS.md`. Invoices, payments and ageing are generic
accounting concepts.

If you later want InvoiceShelf's full invoicing (PDF invoices, estimates,
taxes), the options are:
1. Run **unmodified** InvoiceShelf separately and import its CSV exports into
   PaisaFollow. Running it unmodified for your own business carries no source
   obligation towards PaisaFollow.
2. Fork and modify it, and publish the modified source under the AGPL to its
   users.
3. Keep extending PaisaFollow (recommended for a focused product).

## 2. Obligations from wacrm (MIT)

- Keep `LICENSE` (MIT notice, © Arnas Donauskas) in the repository and in any
  distributed copy or Docker image. ✅ Unchanged.
- There is no obligation to publish your changes, and no restriction on
  charging.

### Decision you need to make: is PaisaFollow open source?

`github.com/shubhamchauhan659/WhatsappCRM` is **public**, and the only license
file at its root is MIT. Anyone reading it will reasonably assume your
PaisaFollow code is MIT too. Pick one:

| Option | What to do |
|---|---|
| **A. Open source (simplest)** | Keep as is. Competitors can legally reuse your code. |
| **B. Proprietary product** | Make the repo private, and add a `NOTICE` saying the PaisaFollow additions (everything listed in "Upstream modification inventory" in ARCHITECTURE.md) are © Shubham Chauhan, all rights reserved, with wacrm portions under MIT. |

Code that is already public stays in forks and caches. If you choose B, do it
before you add anything you consider secret.

## 3. Third-party dependencies

The audit was generated from `package-lock.json` (2026-10-31). The command is
in the appendix.

**Runtime (shipped): 468 packages**

| License | Count | Notes |
|---|---|---|
| MIT | 363 | |
| ISC | 39 | includes `lucide-react` |
| Apache-2.0 (incl. dual) | 35 | includes `sharp`. Keep NOTICE files if present. |
| BSD-2/3-Clause, 0BSD, BlueOak-1.0.0, MIT OR CC0 | 16 | Permissive |
| CC-BY-4.0 | 1 | `caniuse-lite` browser data. Attribution only. |
| **LGPL-3.0-or-later** | 14 | `@img/sharp-libvips-*` prebuilt binaries (image optimisation in Next.js) |

**LGPL note (libvips via sharp).** Running sharp on a server you host is not
"distribution", so it creates no obligation. If you **distribute** the Docker
image (for example, self-hosted installs for customers), include the LGPL text
and libvips copyright notices, and do not prevent users from replacing the
library. libvips is dynamically loaded and its source is public, so in
practice this means keeping the notices. If you never need Next.js image
optimisation, you can drop sharp entirely.

**Dev-only (not shipped): 350 packages.** These are MIT / Apache-2.0
(including PGlite, used for database tests) / ISC / BSD, plus MPL-2.0
(`lightningcss`, `axe-core`) and Python-2.0 (`argparse`). Build tools are not
distributed with the product, so they carry no product obligations.

No AGPL, GPL, SSPL, BUSL or "Commons Clause" dependency is present.

## 4. Services and data terms (not code licenses, but binding)

| Area | What to check before launch |
|---|---|
| Supabase | Terms of Service and DPA. Pick the **Mumbai (ap-south-1)** region for Indian customer data. |
| WhatsApp | `wa.me` click-to-chat is an official WhatsApp feature, and the user sends from their own app. If you later use the WhatsApp Business Platform: Meta's Business Messaging policy, opt-in, approved templates, INR billing (mandatory for India-based accounts by 31 Dec 2026 per [Meta pricing](https://developers.facebook.com/docs/whatsapp/pricing)). **Never** use unofficial WhatsApp Web automation. |
| Email (Brevo/Resend/SES) | Anti-spam terms. Send only transactional mail and customer-approved reminders. |
| India DPDP Act, 2023 + Rules | Your SMB customers are the data fiduciaries for their customers' data; PaisaFollow acts as their processor. You need a privacy policy, a data processing agreement / terms, breach-notification readiness and deletion on request. Confirm current timelines with counsel. |
| AI providers (optional) | Free tiers may use your data for training: Google's Gemini API terms say unpaid-tier prompts are used to improve products outside the EEA/UK/CH ([terms](https://ai.google.dev/gemini-api/terms)). Never send customer data to a free tier. |

## 5. Appendix: reproduce the dependency audit

```bash
node -e "const p=require('./package-lock.json').packages;const c={};for(const[k,i]of Object.entries(p)){if(!k||i.dev)continue;const l=typeof i.license==='string'?i.license:'UNKNOWN';c[l]=(c[l]||0)+1}console.log(c)"
```
