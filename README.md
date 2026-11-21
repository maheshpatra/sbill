# Billflow

Billing for small businesses in India: a public marketing site, a tenant dashboard, and a NestJS API on Supabase. The API forwards the caller's Supabase JWT so Row Level Security enforces isolation.

The target project is `raflrreyawwexjerfqpc` in Mumbai (`ap-south-1`): `https://raflrreyawwexjerfqpc.supabase.co`. Secrets stay as placeholders. The publishable key in the examples is public.

| Path | What it is |
|---|---|
| `web/` | Next.js marketing site, static export |
| `dashboard/` | Next.js app for the business: auth, invoices, payments, customers, plans, settings |
| `api/` | NestJS API |
| `supabase/` | Migrations, RLS, seed, RLS tests |
| `packages/` | GST, UPI, host resolution, shared types, generated API client |

Brand files (swap in place when the final artwork arrives): `billflow-icon.svg`, `billflow-logo-horizontal.svg`, `billflow-logo-horizontal-white.svg`, `favicon.ico`, `og-image.png` under `web/public/brand` and `dashboard/public/brand`.

## Website

`web/` is an App Router site with `output: 'export'`. The landing page is one route:

- Hero, with the approved headline and both CTAs
- Features
- Pricing, with monthly/yearly toggle. Amounts live in `web/src/config/pricing.ts` (Starter free, Growth ₹499/month, Business ₹1,499/month, two months free on yearly)
- FAQ accordion
- Final CTA
- Footer, including the about blurb

Copy is in `web/src/content/landing.ts`. CTAs use `NEXT_PUBLIC_DASHBOARD_URL` (the dashboard sign-up URL). Metadata, Open Graph, and a JSON-LD `SoftwareApplication` block are in `web/src/app/layout.tsx`. The static files land in `web/out/`.

## Dashboard pages

Sign-up and sign-in are Supabase email and password. “Email me a sign-in link” sends a magic link to `/auth/callback`. After sign-in, if the user has no tenant, `/onboarding` calls the `create_tenant` RPC. Every other screen calls the Nest API with the Supabase access token.

| Route | Page |
|---|---|
| `/login`, `/signup` | Email and password, plus magic link |
| `/auth/callback` | Finishes the magic-link session |
| `/onboarding` | Business name and slug, then `create_tenant` |
| `/` | Revenue this month, outstanding, overdue, six-month chart, recent invoices |
| `/invoices` | Search, status filter, pagination, status badges |
| `/invoices/new` | Create a draft. GST totals preview with `@billflow/gst` |
| `/invoices/[id]` | Lines, tax split, payments, mark paid, print view |
| `/invoices/[id]/edit` | Notes, terms, due date, discount |
| `/payments` | Payment list |
| `/customers`, `/customers/new`, `/customers/[id]` | List and create or edit |
| `/billing` | Plans from the API, usage, switch plan |
| `/settings` | GSTIN and business profile, team roles, current plan |

Members see data and cannot create or edit. Billing can write invoices, payments, and customers. Owners and admins can also change the business profile, team, and plan.

## Environment

Root / API (`.env.example`, copied to `api/.env`):

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | `https://raflrreyawwexjerfqpc.supabase.co` |
| `SUPABASE_ANON_KEY` | Publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only. Placeholder until you paste it |
| `SUPABASE_JWT_SECRET` or `SUPABASE_JWKS_URL` | How the API verifies access tokens |
| `DATABASE_URL` | Pooler URL. Password stays a placeholder. Port 6543 for clients, 5432 for migrations |
| `PORT` | API port, `4317` |
| `CORS_ORIGINS` | Comma-separated browser origins. Omit locally (the API reflects the request origin). In production set the dashboard origin |
| `CRON_SECRET` | Header `x-cron-secret` for `POST /internal/cron/mark-overdue` |
| `APP_DOMAIN` | Used when resolving tenant hosts. Default `billflow.app` |

Marketing site (`web/.env.example`, copied to `web/.env.local`). These are inlined at build time:

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_DASHBOARD_URL` | Sign-up URL, default `http://127.0.0.1:4319/signup` |
| `NEXT_PUBLIC_SITE_URL` | Canonical and Open Graph origin |

Dashboard (`dashboard/.env.example`, copied to `dashboard/.env.local`):

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Same project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Publishable key. Safe in the browser |
| `NEXT_PUBLIC_API_URL` | Nest API, `http://127.0.0.1:4317` locally |
| `NEXT_PUBLIC_SITE_URL` | Dashboard origin, used as the magic-link redirect |

In the Supabase dashboard, set **Authentication → URL configuration**:

- Site URL: the dashboard origin (`http://127.0.0.1:4319` locally, the production dashboard URL when you deploy)
- Redirect URLs: `http://127.0.0.1:4319/auth/callback` and the production equivalent `https://<dashboard-host>/auth/callback`

Confirm email sign-up is enabled if you want the password form. Magic links use the same redirect.

## Run everything locally

```bash
cp .env.example api/.env
cp web/.env.example web/.env.local
cp dashboard/.env.example dashboard/.env.local
# Put the real JWT secret or JWKS URL in api/.env before protected API calls will accept live tokens.
npm install
npm run dev
```

`npm run dev` starts all three:

| App | URL |
|---|---|
| API and Swagger | http://127.0.0.1:4317 and http://127.0.0.1:4317/docs |
| Marketing site | http://127.0.0.1:4318 |
| Dashboard | http://127.0.0.1:4319 |

`npm test` runs the API suite plus the marketing copy/pricing checks and the dashboard role and money checks. `npm run build` builds packages, the API, the static site, and the dashboard.

## Plan entitlements

Platform plans are `free`, `starter`, `growth`, and `business`. Prices are stored in INR paise (`price_monthly_paise`, `price_yearly_paise`) and also in rupees for older clients. `features` is the catalog of keys. `plan_features` says which plan enables each key and, for `max_*` keys, the numeric cap (`null` is unlimited). `tenant_subscriptions` is the plan Billflow bills to the tenant: status, period, trial end, `cancel_at_period_end`, grace, and the Razorpay or manual provider ids. `subscriptions` is a legacy mirror of that table. A tenant's own customers stay in `customers`. `tenant_feature_overrides` can grant or remove one key. Authenticated users can read the catalog and their own subscription. There is no write policy, so plan changes go through the API service role.

`has_feature(tenant, key)` and `feature_limit` resolve the open subscription, fall back to Free when a past-due grace has expired, then apply an override. Triggers reject inserts the plan does not allow: products, stock, POS invoices, GST lines, custom domains, and non-classic published templates. `over_limit_grace` blocks new invoices, products, customers, members, and domains while leaving existing rows readable. The API adds `@RequiresFeature('key')` and `EntitlementsGuard`, caches the entitlement payload for the request, and returns `402` with `code: FEATURE_LOCKED` and `required_plan`, or `403` with `LIMIT_REACHED`. Reminder enqueue and the hourly cron both check `auto_reminders`. Public sites hide a custom domain the plan does not include and fall back to the Classic template.

Listed prices are exclusive of 18% GST. An upgrade charges the full new price immediately and starts a new period the same day. Unused time on the old plan is not credited. A downgrade sets `pending_plan_id` and applies at `current_period_end`. If usage is already over the new caps, `over_limit_grace` turns on. A failed Razorpay payment sets `past_due` and `grace_until` seven days out. The hourly job, `apply_plan_transitions()`, then moves the tenant to Free. Cancelling does the same at period end.

Razorpay: create a live or test key pair, set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`, and set `RAZORPAY_WEBHOOK_SECRET`. Point the webhook at `POST /public/billing/razorpay` for `payment.captured` and `payment.failed`. The handler checks the HMAC signature and stores the event id so a retry does not activate twice. Checkout returns the key id and order id for Checkout.js. Stripe is a stub and does not create a session. Set `PLATFORM_GSTIN` and `PLATFORM_STATE_CODE` (default 27). A captured payment writes a platform GST invoice: CGST+SGST when the tenant state matches, otherwise IGST. `BILLING_DEV_ACTIVATE=true` activates a manual checkout without Razorpay. Leave it unset in production.

Free: basic invoices, 1 user, 20 invoices a month. Starter (₹199): GST invoices, catalog, UPI links, WhatsApp click-to-chat. Growth (₹499): reminders, POS, online payments, roles, stock, reports. Business (₹1,499): custom templates, custom domains, WhatsApp Cloud API, higher limits. New tenants start on Free. Seeded tenants: Plain Goods on Free, Northwind on Starter, Acme on Growth, Saffron on Business. The marketing prices in `web/src/config/pricing.ts` use these same rupee amounts. Yearly is ten months.

## UPI QR

Payment settings live on the tenant: `upi_vpa` and `upi_payee_name`, edited by an owner or admin at **Settings → Payments**. The VPA is checked in the API and by a database constraint (`^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$`). The page shows a ₹1 test QR that does not create a payment.

`@billflow/upi` builds `upi://pay` with two-decimal amounts, URL encoding, a note of at most 50 characters, and a `tr` reference. QR codes use `qrcode` with error correction M and a four-module quiet zone. Invoice **Collect via UPI** (full balance or a part) and a POS UPI charge each insert a `payments` row with method `upi_qr` and status `pending`. The same pending row is reused for that amount, and it is embedded on the PDF and on the public share page.

**Payment received** optionally records a 12-digit UTR, marks the payment succeeded, and sets the invoice to `paid` or `partially_paid`. **Cancel / not received** voids the pending row. Both write an `audit_logs` entry (`upi.confirmed` or `upi.voided`). On the counter, confirmation then prints the receipt.

This is manual confirmation. Nothing here asks the bank whether the money arrived. A later reconciliation can match `tr` to a Razorpay or Cashfree UPI collect webhook, or to a bank statement line that carries the same reference.

Invoice UPI QR is enabled on Free and every paid plan (`upi_qr`). The counter UPI screen still requires the POS feature.

Cash uses the same payment chooser. **UPI QR** and **Cash** are the two primary options. The selector opens on the method this browser last used, or on the latest payment if there is no saved choice. Cash shows the amount due, an amount received, and buttons for the exact total and for ₹100, ₹200, ₹500, and ₹2,000. Change is calculated and can be edited. On the counter the cash received must cover the bill. On an invoice a smaller amount is a part payment. The payment row stores method `cash`, the amount applied, `amount_tendered`, `change_given`, status `succeeded`, and `recorded_by` for the cashier. The invoice becomes `paid` or `partially_paid`. A counter sale is one database transaction and the receipt prints the tendered and change lines. Cash is enabled on every plan, including Free (`cash_payments`).

## Customer Razorpay

Online collection uses the tenant’s own Razorpay account. It is separate from `RAZORPAY_KEY_ID`, which billflow uses to charge the tenant for a plan.

1. In the Razorpay dashboard, switch on **Test mode** and create a test API key.
2. Add a webhook for `https://<your-api>/public/payments/razorpay/<tenant-id>` and subscribe to `payment.captured`, `payment_link.paid`, `payment.failed`, and `refund.processed`.
3. Set `PAYMENT_SECRETS_KEY` to 32 bytes of base64. The API encrypts the key secret and the webhook secret with AES-256-GCM. The browser only receives the key id and whether the account is connected.
4. An owner or admin opens **Settings → Payments → Razorpay**, saves the key id, key secret, and webhook secret, then uses **Test connection**.

The Online tab sits beside UPI QR and Cash. It is available on plans with `online_payments` (Growth and Business). Other plans see the tab locked. If the plan includes it but Razorpay is not connected, the tab asks the tenant to connect it. Switching tabs voids a pending UPI or Razorpay intent.

**Take payment here** opens Razorpay Checkout for an order created on the server. Notes on the order carry `tenant_id`, `invoice_id`, and `payment_intent_id`. The browser posts the checkout signature to `POST /payments/:id/razorpay/verify`. **Send a link** creates a Razorpay Payment Link, shows a QR, and offers WhatsApp and SMS share. The page polls the payment until the webhook marks it succeeded. A captured payment is stored as method `razorpay`, status `succeeded`, with `transaction_ref` set to the Razorpay payment id. The invoice becomes paid or partially paid. On the counter, the receipt is shown after that. A failed payment can be retried or the method can be switched. `POST /payments/:id/refund` refunds a captured payment when Razorpay accepts it.

Razorpay Route or Partner OAuth can replace pasted keys later: the platform would onboard the tenant and store a connected-account id instead of a secret. The checkout and webhook flow stays the same.

## WhatsApp, GST, reminders, and the counter

### WhatsApp invoice sharing

`POST /invoices/:id/share` creates an unguessable token that expires. `GET /public/invoices/:token` and `https://<marketing-host>/i/:token` show only that invoice. `POST /invoices/:id/share/revoke` kills outstanding links. `GET /invoices/:id/pdf` renders a PDF and, when Storage is available, stores it in the private `invoice-pdfs` bucket under `{tenant_id}/`.

`POST /invoices/:id/whatsapp` sends a Meta template message when the tenant has a phone number id and access token. Otherwise it returns a `wa.me` link and still writes `message_logs`. The token column is revoked from `authenticated` SELECT. Meta delivery updates come to `POST /public/whatsapp/webhook` (the verify handshake uses `WHATSAPP_VERIFY_TOKEN`).

Meta setup: create a WhatsApp Business app, add the Cloud API, copy the phone number id and a permanent token into Dashboard → WhatsApp (or `WHATSAPP_*` env as a fallback). Submit a template named `invoice_share` with body variables for the invoice number, link, and total. Set the webhook callback to `/public/whatsapp/webhook`.

### GST invoices

Seller GSTIN, legal name, state, and address already live on `tenants`. Customers gained `billing_state_code` and `reminder_opt_out`. Lines gained `unit` and a line `discount`. Invoices store `document_type` (`tax_invoice`, `bill_of_supply`, `credit_note`, `debit_note`), financial year, CGST/SGST/IGST totals, amount in words, and e-invoice fields (`irn`, `ack_no`, `ack_date`, `signed_qr`, `einvoice_status`). Same-state supply is CGST+SGST. Different states are IGST. Numbers are gapless per tenant per April–March year and at most 16 characters. `POST /gstin/validate` checks the checksum. `GET /reports/gstr1?from=&to=` returns a CSV by HSN and rate. `POST /invoices/:id/credit-note` drafts a credit note. `POST /invoices/:id/einvoice` is an IRP/GSP stub: implement `EinvoiceProvider` against your GSP; `EINVOICE_STUB=success` only writes a fake IRN for tests.

### Reminders

`reminder_schedules` defaults to −3, 0, +3, +7, and +14 days. `enqueue_due_reminders()` inserts `reminder_jobs` with a unique idempotency key so a reminder is not sent twice. Opt-out is `customers.reminder_opt_out`. The hourly Nest cron (`CRON_ENABLED=true`) marks overdue invoices and processes the queue with exponential backoff (15 minutes, doubling, five attempts). `POST /internal/cron/reminders` with `x-cron-secret` does the same run. A Supabase alternative is `pg_cron` calling `enqueue_due_reminders()` plus an Edge Function that hits the cron endpoint. SMS uses MSG91 (DLT template id on the flow API) or Twilio. Email uses Resend or SMTP via nodemailer. Per-tenant non-secret fields are in `messaging_settings`; keys stay in `secrets`, which authenticated roles cannot select. Env fallbacks are listed in `.env.example`.

MSG91: register a sender id and a DLT template, then set `MSG91_AUTH_KEY`, `MSG91_SENDER_ID`, and `MSG91_DLT_TEMPLATE_ID`. Twilio: Account SID, auth token, and a from number. SMTP: host, port, user, and password. Resend: API key and a verified from address.

### POS

`products` holds SKU, barcode, HSN, price, GST, and optional stock. `/pos` is a fullscreen counter: search, barcode (Enter adds the first match), cart in `localStorage`, `/` focuses search, GST preview, cash change, UPI intent from the tenant VPA, or a manual card payment. `POST /pos/checkout` is one `pos_checkout` transaction that writes the invoice, lines, stock movement, and payment. The receipt view prints at 58mm or 80mm. Settings are at `/pos/settings`.

## Public sites, DNS, and SSL

One Next.js app (`web/`) serves the marketing site and every tenant storefront. Middleware reads the `Host` header (`ROOT_DOMAIN`, default `billflow.com`):

- `billflow.com` and `www.billflow.com` render the marketing page.
- `acme.billflow.com` rewrites to `/sites-host/acme` and loads the published template with `get_site_by_host`. A folder named `_sites` would be private in the App Router and would not be routable, so the internal path is `sites-host`.
- A verified custom domain does the same. Unverified domains and unpublished drafts return 404.
- On localhost, open `acme.localhost:4318` or `http://127.0.0.1:4318/?host=acme.localhost`. The `?host=` override is ignored on any other host.

The page caches the RPC response for 60 seconds (`revalidate`). Anonymous callers cannot read `templates`, `tenant_template_settings`, or `tenant_domains`. The security-definer RPC returns only the published public fields.

Dashboard → Website lists the Classic, Modern, and Minimal templates, previews unsaved overrides in an iframe, uploads a logo to the `tenant-assets` storage bucket (`{tenant_id}/…`), and saves a draft or publishes. Subdomain changes and custom domains (TXT `_billflow-verify` plus CNAME) are on the same page.

**Wildcard DNS.** Point `*.billflow.com` and the apex at this Next.js app. Issue a wildcard certificate with DNS-01 (the CA needs a TXT record on `_acme-challenge.billflow.com`). Vercel does this when you add `*.billflow.com` as a wildcard domain on the project. A static Hostinger upload cannot run the middleware, so this app needs Vercel or a Hostinger Node.js app (`npm run start -w @billflow/web`).

**Custom domains.** The merchant adds `pay.example.com`. They create:

- `TXT _billflow-verify.pay.example.com` = the token shown in the dashboard (`billflow-verify=…`)
- `CNAME pay.example.com` → `sites.billflow.com` (or the host your platform gives you)

`POST /website/domains/:id/verify` looks up the TXT record and marks the domain verified. The certificate is then issued per domain:

- Vercel Domains API: add the domain to the project after it verifies, and Vercel provisions the cert.
- Caddy on-demand TLS: `on_demand_tls` asks this app (or a tiny endpoint) whether `get_site_by_host` returns a verified domain, then Caddy fetches a cert.
- Cloudflare for SaaS: custom hostnames with the same CNAME target, certificates managed by Cloudflare.

Until the TXT record exists, the domain stays unverified and the public site does not resolve it. `ssl_status` stays `pending` after verification because the certificate is issued by the edge, not by Postgres.

**Hostinger.** Use Node.js hosting for `web` (middleware) and `dashboard` (dynamic routes). The marketing-only static export was replaced so one process can route by host. Set `ROOT_DOMAIN`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `NEXT_PUBLIC_DASHBOARD_URL` in the Node app. Point the wildcard DNS at that app. Hostinger’s shared static hosting can still hold a frozen copy of the marketing page, but it will not serve tenant subdomains.

## Deployment

**Marketing site.** `npm run build -w @billflow/web` writes `web/out`. Upload that folder to Hostinger static hosting, or point Vercel at the `web` directory with the Next.js preset (the `output: 'export'` config still produces a static site). Set `NEXT_PUBLIC_DASHBOARD_URL` and `NEXT_PUBLIC_SITE_URL` before the build. There is no Node server to run.

**Dashboard.** This is a Next.js server app (dynamic invoice and customer routes). On Vercel, set the root to `dashboard` and add the `NEXT_PUBLIC_*` variables. On Hostinger, use a Node.js app: `npm run build -w @billflow/dashboard` then `npm run start -w @billflow/dashboard` (port 4319). A purely static host cannot serve the dynamic routes.

**API.** Host the Nest app as a Node process. From `api/`, after a build, `npx nest start` (or `node dist/main.js`) listens on `PORT`. Set `CORS_ORIGINS` to the dashboard origin. Set `SUPABASE_JWT_SECRET` or `SUPABASE_JWKS_URL`, and the service-role key, on the server only.

**Supabase.** Run `supabase/apply_all.sql` then `supabase/seed.sql` in the SQL editor (or `supabase db push`) before the dashboard can load plans. Enable the custom access token hook if you want `tenant_id` on the JWT. The API still works without it, because RLS looks up membership.

Apply the schema before expecting `GET /billing/plans` to succeed against the hosted project. Until those tables exist, the live API returns a schema-cache error and the dashboard shows that message.

## Architecture

```
browser  --Supabase Auth-->  access token (JWT)
   |                              |
   |  Authorization: Bearer       |
   v                              v
NestJS API  --anon key + JWT-->  PostgREST / Supabase
                                      |
                                      v
                                 Postgres RLS
                                 auth.uid() -> memberships
```

- Sign-in stays in Supabase Auth. The API does not issue passwords.
- `SupabaseAuthGuard` verifies the JWT with `SUPABASE_JWT_SECRET` (HS256) or `SUPABASE_JWKS_URL` (RS256/ES256).
- Each request builds a `@supabase/supabase-js` client with the anon key and the caller's `Authorization` header. PostgREST runs as `authenticated`, and RLS filters rows.
- User-facing routes use the anon key plus the caller's JWT. The service-role key is for webhooks, cron, tenant Razorpay secrets, the WhatsApp Cloud API token, and best-effort PDF and delivery-log writes. The list is in `docs/FRONTEND_HANDOFF.md`. It is never returned to a browser.
- A user can belong to several tenants through `memberships`. `users.tenant_id` and `users.role` mirror the active membership. Invoice totals are computed in the API (`@billflow/gst`) and again by database triggers, which are what get stored.

## Schema

| Table | What it holds |
|---|---|
| `tenants` | Organisation: slug, plan code, status, GSTIN, UPI VPA, invoice prefix, currency (default INR) |
| `users` | Profile. `id` references `auth.users`. `tenant_id`, `active_tenant_id`, and `role` mirror the active membership |
| `memberships` | Source of truth. One row per user per tenant. Role `owner`, `admin`, `billing`, `member` |
| `invitations` | Pending email invites. Accepted by the auth-user trigger when that email signs up |
| `plans` | Catalog (`starter`, `growth`, `pro`) and `features` jsonb |
| `subscriptions` | The tenant's Billflow subscription: plan, price, `monthly`/`yearly`, status, period |
| `customers` | The tenant's own clients |
| `tax_rates` | Per-tenant GST rates |
| `invoice_counters` | Per-tenant invoice number sequence (`INV-0001`) |
| `invoices` | Number unique per tenant, amount, tax, total, status `draft/sent/paid/overdue/void`, currency default INR |
| `invoice_items` | Lines with HSN/SAC, GST split into CGST/SGST or IGST |
| `payments` | Amount, method, status, transaction ref, `paid_at` |
| `invoice_balances` | View: total, amount paid, balance (security invoker) |
| `sites` | Tenant public site. One per tenant. Custom domain optional |
| `webhook_endpoints` / `webhook_deliveries` | Outbound events (`invoice.paid`, `invoice.sent`, …) signed `X-Billflow-Signature: sha256=…` |
| `audit_logs` | Append-only. Written by a security-definer trigger |
| `platform_settings` | Singleton `app_domain` (default `billflow.app`) used by `get_site_by_host` |

Every mutable table has `created_at` / `updated_at` and an `updated_at` trigger. Primary keys are uuids. `audit_logs` is append-only (`created_at` only).

## RLS

RLS is enabled on every public table. Helper functions are `SECURITY DEFINER` with a fixed `search_path`, so policies do not recurse. `EXECUTE` is revoked from `PUBLIC` and granted back only where noted.

`current_tenant_id()` uses a JWT `tenant_id` claim only when the caller has an active membership in that tenant. Otherwise it uses `users.active_tenant_id`, then the earliest active membership. A forged claim cannot cross tenants. See `docs/FRONTEND_HANDOFF.md`.

| Table | Who can read | Who can write |
|---|---|---|
| `plans`, `platform_settings` | `anon` and `authenticated` (public plans only) | service role |
| `tenants` | members of that tenant | owner/admin, active tenant only |
| `users` | yourself, or members of the active tenant | yourself, `name` column only |
| `memberships` | your rows, or rows in the active tenant | owner/admin. Last owner cannot be removed |
| `invitations`, `subscriptions`, `sites`, webhooks | active tenant (webhooks: owner/admin) | owner/admin |
| `customers`, `tax_rates`, `invoices`, `invoice_items`, `payments` | active tenant | owner/admin/billing. Members are read-only |
| `invoice_counters` | active tenant | only via `next_invoice_number()` |
| `audit_logs` | owner/admin/billing | trigger only |
| `sites` (published) | not via the table for anon | `get_site_by_host` (security definer) for anon |

Invoice lines can change only while the invoice is `draft`. Invoice numbers and `tenant_id` are immutable. Status moves `draft → sent → overdue/paid → void`. An invoice becomes `paid` only when succeeded payments cover the total. Voiding requires refunds first.

## Grants

This Supabase project was created with **automatic Data API grants off**. Migrations grant privileges explicitly. RLS still filters rows after the grant.

- `anon`: `USAGE` on `public`, `SELECT` on `plans` and `platform_settings`, `EXECUTE` on `get_site_by_host(text)`.
- `authenticated`: DML on tenant tables (column-limited update on `users`), `EXECUTE` on `current_tenant_id`, `current_user_role`, `create_tenant`, `set_active_tenant`, `invite_member`, `get_site_by_host`, and the membership helpers.
- `service_role`: `ALL` on tables, sequences, and functions. On hosted Supabase this role also bypasses RLS.
- `supabase_auth_admin`: `EXECUTE` on `custom_access_token_hook` and `SELECT` on `users` and `memberships`, and only if that role exists.

Default privileges for objects created later by the migration role: full access for `service_role`, DML for `authenticated`. New functions are **not** executable by `anon` or `authenticated` until granted. That is deliberate: security-definer helpers must be opted in. Enable RLS on every new public table; a grant without a policy exposes nothing to `anon` only when RLS is on, and a missing policy is not a substitute for a grant review.

## Apply the migrations

Migrations are in `supabase/migrations/` and run top to bottom. `supabase/apply_all.sql` is the same SQL concatenated. The first migration drops the earlier draft (`public.tenants`, `public.users`, `current_tenant_id`, `current_user_role`, and their policies) with `IF EXISTS`, so it is safe on an empty project and on the project where that draft was already applied. There is no production data in those tables.

**SQL editor** (hosted project): open `supabase/apply_all.sql`, run it, then run `supabase/seed.sql`. The seed does not insert `auth.users`. It loads three demo tenants (Acme Traders, Northwind Studios, Saffron Retail), plans are already in the migration, plus customers, subscriptions, invoices, lines, and payments.

**Supabase CLI:**

```bash
supabase link --project-ref raflrreyawwexjerfqpc
supabase db push
```

Use the session pooler (port 5432) if you apply SQL with `psql`. The transaction pooler (port 6543) is for short API connections. User `postgres.raflrreyawwexjerfqpc`, host `aws-1-ap-south-1.pooler.supabase.com`. The password stays in your dashboard.

```bash
psql "postgresql://postgres.raflrreyawwexjerfqpc:[YOUR-PASSWORD]@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" \
  -f supabase/apply_all.sql
psql "…same session url…" -f supabase/seed.sql
```

## Auth hook

After the migrations:

1. Dashboard → **Authentication** → **Hooks**.
2. Add a **Custom Access Token** hook.
3. Choose Postgres function `public.custom_access_token_hook`.
4. Save.

The function writes `tenant_id` and `user_role` onto the JWT from the caller's active membership. RLS still checks `memberships`. The API works without the hook; the hook lets the client read the active tenant off the token. Users who belong to several tenants should call `POST /tenants/switch` and then `supabase.auth.refreshSession()`.

`handle_new_user` runs on `auth.users` insert and creates `public.users`. Pending invitations for that email become memberships.

## Sample API calls

The API listens on `http://127.0.0.1:4317` when you run `npm run dev`. Swagger is at `/docs`. Health is `GET /health`.

```bash
curl -s http://127.0.0.1:4317/health

curl -s http://127.0.0.1:4317/billing/plans

curl -s -X POST http://127.0.0.1:4317/tenants \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Acme Traders","slug":"acme-demo"}'

curl -s http://127.0.0.1:4317/entitlements \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"

curl -s -X POST http://127.0.0.1:4317/invoices \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "customer_id": "CUSTOMER_UUID",
    "supply_type": "intra",
    "items": [{ "description": "Retainer", "quantity": 2, "unit_price": 10000, "tax_rate": 18, "hsn_sac": "9982" }]
  }'

curl -s -X POST http://127.0.0.1:4317/invoices/INVOICE_UUID/mark-paid \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"amount":23600,"method":"upi","transaction_ref":"UPI-ACME-1"}'

curl -s "http://127.0.0.1:4317/sites/resolve?host=acme.billflow.app"
```

`npm run lint` covers the API and both Next.js apps.

## RLS proof

`npm run test:rls` needs local Postgres 15+ (the script uses `sudo -u postgres`). It:

1. Creates a throwaway database and a stub `auth` schema (`auth.users`, `auth.uid()` reading `request.jwt.claim.sub`).
2. Applies a stand-in of the old draft, then `apply_all.sql`, then the seed twice.
3. Runs `supabase/tests/rls_test.sql`.

That test checks tenant A cannot read or write tenant B, a forged `tenant_id` claim does not widen access, members are read-only, billing can create an invoice and a payment (total computed as 1180 and status becomes `paid`), `create_tenant` returns the owner, and `anon` can read plans and resolve a published site but not invoices.

## Packages

| Package | Role |
|---|---|
| `@billflow/types` | Feature keys, `Entitlements`, roles |
| `@billflow/gst` | Tax-exclusive GST. Intra-state splits CGST/SGST. Inter-state is IGST |
| `@billflow/upi` | `upi://pay` URIs and QR data URLs |
| `@billflow/host-resolution` | `resolveHost` / `createHostResolver` |
| `@billflow/api-client` | `createBillflowClient`, types generated from `api/openapi.json` |

Regenerate the client with `npm run openapi` after an API change (the root `npm run build` does this).
