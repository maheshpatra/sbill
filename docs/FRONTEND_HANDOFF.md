# Frontend handoff

The marketing site is `web/` and the tenant app is `dashboard/`. This document is the API contract. The API speaks **snake_case JSON**.

The database script for the hosted project is `supabase/billflow_full.sql`.

## 1. Repository and branch

- Origin: `https://origin.cursor.com/git/finafid/tmp-c5237ee4c4d4ea50`
- Branch: `main`

## 2. OpenAPI, base URL, port

| | |
|---|---|
| Spec file | `api/openapi.json` |
| Live spec | `GET http://127.0.0.1:4317/docs-json` |
| Swagger UI | `http://127.0.0.1:4317/docs` |
| Local API | `http://127.0.0.1:4317` |
| Marketing site | `http://127.0.0.1:4318` |
| Dashboard | `http://127.0.0.1:4319` |
| Typed client | `@billflow/api-client` (`packages/api-client`), generated from that spec |

```ts
import { createBillflowClient } from '@billflow/api-client';

const client = createBillflowClient({
  baseUrl: 'http://127.0.0.1:4317',
  token: session.access_token, // Supabase access token
});
```

Send `Authorization: Bearer <supabase access token>` on every route except the public ones below. The API forwards that JWT to Supabase so RLS decides which rows come back.

Public routes (no user bearer token):

- `GET /health`
- `GET /billing/plans`
- `GET /sites/resolve?host=`
- `GET /public/invoices/:token`
- `GET /public/whatsapp/webhook` and `POST /public/whatsapp/webhook`
- `POST /public/billing/razorpay` (platform subscription webhook)
- `POST /public/payments/razorpay/:tenantId` (that tenant's customer-payment webhook)
- `POST /internal/cron/mark-overdue` and `POST /internal/cron/reminders` (header `x-cron-secret`)
- `GET /public/ledger/:token` and `POST /public/ledger/:token/upi`
- `GET /i18n/labels`

Host classification lives in `@billflow/host-resolution`:

```ts
import { resolveHost } from '@billflow/host-resolution';

resolveHost(request.headers.host, { appDomain: 'billflow.com' });
// { kind: 'marketing' | 'dashboard' | 'tenant-subdomain' | 'custom-domain', host, slug? }
```

`localhost` is the dashboard. `{slug}.localhost` is a tenant subdomain. For `tenant-subdomain` and `custom-domain`, call `GET /sites/resolve?host=`.

## 3. Plans and entitlements

### `GET /billing/plans` (public)

Returns `{ data: Plan[] }` ordered by `sort_order`. Each plan has `code`, `name`, `description`, `price_monthly`, `price_yearly` (rupees), `price_monthly_paise`, `price_yearly_paise`, `currency` (`INR`), `features`, `limits`, `sort_order`, `active`.

Codes are `free`, `starter`, `growth`, `business`. New tenants start on `free`.

### `GET /entitlements` (bearer)

```json
{
  "tenant_id": "uuid",
  "plan": "free",
  "plan_name": "Free",
  "subscription_status": "trialing",
  "over_limit_grace": false,
  "features": { "upi_qr": true, "cash_payments": true, "pos": false },
  "usage": {
    "invoices_this_month": 0,
    "customers": 0,
    "members": 1,
    "products": 0,
    "custom_domains": 0
  }
}
```

Feature keys (`FEATURE_KEYS` in `@billflow/types`, plus `cash_payments` on the plan rows):

| Key | Free | Starter | Growth | Business |
|---|---|---|---|---|
| `basic_invoices`, `public_site`, `upi_qr`, `cash_payments` | yes | yes | yes | yes |
| `gst_invoices`, `product_catalog`, `whatsapp_click_to_chat` | | yes | yes | yes |
| `auto_reminders`, `online_payments`, `pos`, `multi_user_roles`, `stock_tracking`, `reporting_dashboard`, `webhooks`, `audit_log`, `api_access` | | | yes | yes |
| `custom_templates`, `custom_domains`, `whatsapp_sharing`, `remove_branding`, `priority_support` | | | | yes |

Numeric caps are `max_users`, `max_invoices_per_month`, `max_customers`, `max_products`, `max_custom_domains`. `null` means unlimited. Aliases still returned: `invoices_per_month`, `customers`, `members`, `custom_domain`.

A locked feature returns **402** with `code: FEATURE_LOCKED` and `required_plan`. A cap returns **403** with `code: LIMIT_REACHED`.

Plan changes:

- `POST /billing/checkout` `{ "plan_code", "billing_cycle" }` starts a Razorpay order for an upgrade. `billing_cycle` is `monthly` or `yearly`. Owner or admin only. A paid plan with no platform Razorpay keys returns **503** `BILLING_NOT_CONFIGURED`. That check happens before any service-role call. A missing or placeholder `SUPABASE_SERVICE_ROLE_KEY` does not turn this into `Invalid API key`.
- `POST /billing/subscription` schedules a downgrade for the end of the period.
- `POST /billing/subscription/cancel` sets `cancel_at_period_end`.
- `GET /billing/subscription` and `GET /billing/invoices` are the current platform subscription and the GST invoices billflow issued to the tenant.

Those platform Razorpay keys are not the tenant's customer-collection keys.

## 4. `create_tenant` RPC

```sql
create_tenant(p_name text, p_slug text) returns jsonb
```

HTTP: `POST /tenants` with `{ "name": "Acme Traders", "slug": "acme" }`.

`slug` is lowercase kebab-case. Reserved: `www`, `app`, `api`, `billing`, `admin`, `static`, `dashboard`, `auth`, `mail`.

The RPC creates the tenant on the **free** plan, an owner membership for `auth.uid()`, a 14-day trial subscription, GST rates, an invoice counter, and an unpublished site.

```json
{
  "id": "uuid",
  "name": "Acme Traders",
  "slug": "acme",
  "plan": "free",
  "status": "trialing",
  "currency": "INR",
  "role": "owner",
  "membership_id": "uuid",
  "created_at": "2026-11-20T00:00:00+00:00"
}
```

Refresh the Supabase session afterwards so the access token picks up `tenant_id` and `user_role`. Until the hook is enabled, the API still works: `current_tenant_id()` resolves the tenant from the user JWT.

`POST /tenants/switch` with `{ "tenant_id": "uuid" }` changes the active tenant. Refresh the session afterwards.

`POST /tenants/members` with `{ "email", "role" }` invites `admin`, `billing`, or `member`. That call requires `multi_user_roles`.

## 5. How RLS decides the tenant

**RLS looks up membership.** It does not trust a `tenant_id` claim by itself.

`current_tenant_id()` is `SECURITY DEFINER`. It reads `tenant_id` from the JWT only as a hint when a person belongs to more than one tenant. It returns that tenant only when `memberships` has an **active** row for `auth.uid()`. A missing or forged claim falls back to `users.active_tenant_id`, then to the earliest active membership.

`current_user_role()` is the role on that membership: `owner`, `admin`, `billing`, or `member`.

| Role | Can do |
|---|---|
| `member` | Read the active tenant's billing data |
| `billing` | Read, plus customers, tax rates, invoices, lines, and payments |
| `admin`, `owner` | Billing access, plus the tenant profile, members, the platform subscription, the site, and webhooks |

Plan changes have no client write policy. Checkout, a scheduled downgrade, and cancel go through owner/admin RPCs (`record_billing_checkout`, `activate_platform_checkout`, `schedule_platform_plan`, `cancel_platform_subscription`) using the anon key and the user JWT. Secrets (`whatsapp_settings.access_token`, `messaging_settings.secrets`, `messaging_settings.secrets_enc`, `tenant_razorpay.key_secret_enc`, `tenant_razorpay.webhook_secret_enc`) are not selectable by `anon` or `authenticated`.

`GET` and `PUT /settings/messaging` also use that user client. `messaging_secret_flags()` returns only booleans. The API encrypts provider secrets and writes them with `save_messaging_settings`. `messaging_secrets_enc()` exists so the API can merge an omitted secret; it is not an HTTP route and its ciphertext is never returned to the browser.

## Service role

User-facing routes are meant to run with `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and the caller's JWT. These still need `SUPABASE_SERVICE_ROLE_KEY` because there is no user JWT, or because they read or write a secret the authenticated role cannot see:

| Route | Why |
|---|---|
| `POST /public/billing/razorpay` | Platform webhook. Claims the event and activates the subscription. |
| `POST /public/payments/razorpay/:tenantId` | Tenant webhook. Reads that tenant's webhook secret and updates the payment. |
| `POST /internal/cron/mark-overdue` | No user. Calls `mark_overdue_invoices`. |
| `POST /internal/cron/reminders` | No user. Reads messaging and WhatsApp secrets and sends due reminders. |
| `PUT /settings/razorpay`, `POST /settings/razorpay/test` | Reads and writes `tenant_razorpay` ciphertext. |
| `POST /invoices/:id/razorpay`, `POST /payments/:id/razorpay/verify`, `POST /payments/:id/refund`, POS online | Reads the tenant Razorpay secret and stamps provider ids on the payment. |
| `POST /invoices/:id/whatsapp` | Cloud API send reads `whatsapp_settings.access_token`. The `wa.me` link does not. |
| Invoice PDF storage upload | Best-effort copy to the `invoice-pdfs` bucket. A missing key does not fail the download. |
| Webhook delivery log | Best-effort insert on `webhook_deliveries` after the user's own request. A missing key is logged and ignored. |

The optional hook `public.custom_access_token_hook` adds `tenant_id` and `user_role` to the JWT. Enable it under **Authentication → Hooks → Custom Access Token**. Execute is granted to `supabase_auth_admin` only.

## Error shape

```json
{
  "statusCode": 402,
  "error": "Payment Required",
  "message": "pos is included on the growth plan",
  "code": "FEATURE_LOCKED",
  "feature": "pos",
  "required_plan": "growth",
  "path": "/pos/checkout",
  "timestamp": "2026-11-20T00:00:00.000Z"
}
```

`code`, `feature`, and `required_plan` are present on entitlement errors. `message` is a string or an array of validation messages.

Pages are `{ "data": [], "page": 1, "limit": 20, "total": 0 }`.

## Round 2 contracts

`cursor/billflow-frontend-6380` at `3ec5a4c` did not yet contain a "Contracts needed from backend (round 2)" section. The routes below follow the shapes named in that request. Where this API differs, it says so.

Hosted SQL: `supabase/fixes/2026-11-20_counter_ops.sql` (same as migration `supabase/migrations/20261120230000_counter_ops.sql`). Safe to re-run. These routes use the anon key and the user JWT. They do not read the service-role key.

### `POST /sync/sales`

```json
{
  "device_id": "till-1",
  "sales": [{
    "client_id": "uuid",
    "customer_id": "uuid or omit",
    "lines": [{ "description": "Rice", "quantity": 1, "unit_price": 50, "gst_rate": 0, "unit": "kg", "product_id": "uuid" }],
    "payments": [{ "client_id": "uuid", "method": "cash", "amount": 50, "amount_tendered": 100, "change_given": 50 }]
  }]
}
```

Response: `{ "results": [{ "client_id", "status": "created"|"exists"|"conflict", "invoice_id", "number", "reason" }] }`.

Idempotent on `client_id`. A replay returns `exists` and the same server number. A new payment `client_id` on that invoice is applied; a repeated payment `client_id` is skipped. A void invoice returns `conflict` / `voided` and is not changed. Any other failure for that sale is `conflict` with `reason`, and that sale is rolled back.

**Difference:** invoice numbers are the server financial-year series (`next_invoice_number`). They are not a device-prefixed series. `device_id` is stored and is not part of the number. A client-supplied number is ignored. A missing `customer_id` uses the tenant's single `Walk-in` customer. Synced invoices use `source: billing`, so they are not blocked by the POS entitlement.

### `GET /pos/tiles`

`{ "favourites": [{ "id", "name", "unit", "price", "gst_rate", "stock", "favourite": true }], "top_sellers": [{ "name", "sold_qty", "product_id" }] }`.

Favourites are `products.is_favourite`. Set it with `favourite: true` on `POST /products` or `PUT /products/:id`. Top sellers are the last 30 days, matched to a product by name.

`categories` is each shop category with its `tiles`. `uncategorized` is products with no category. `GET /pos/tiles?category_id=` keeps only that category, and filters favourites and top sellers the same way.

`GET /product-categories`, `POST /product-categories`, `PUT /product-categories/:id`, and `DELETE /product-categories/:id` need `product_catalog`. Body is `{ "name", "sort_order" }`. `category_id` on a product points at one of these.

### `GET /purchases` and `POST /purchases`

```json
{
  "supplier": "Northwind",
  "bill_date": "2026-11-20",
  "photo_ref": "purchase-bills/dal.jpg",
  "notes": "",
  "lines": [{ "product_id": "uuid", "description": "Dal", "quantity": 2, "unit_price": 40, "gst_rate": 5 }]
}
```

`photo_ref` is an optional string the client already has (a storage path or a filename). This route does not upload the file. GST can be on each line, or a purchase-level `gst_rate` used when a line omits it. The response includes `taxable`, `tax`, `total`, and `lines`.

Any billing role can save a purchase. Stock increases only for a line with `product_id` when that product already tracks stock and the tenant has `stock_tracking`. Otherwise the purchase is stored and stock is left alone.

### Public ledger and Razorpay

Creating a Razorpay order from the public ledger would need the service-role key to read `tenant_razorpay` ciphertext. That stays off this route. `razorpay_available` tells the client the tenant has a key id. The logged-in collect path remains `POST /invoices/:id/razorpay`.

### `GET /dashboard/morning`

```json
{
  "yesterday": { "sales": 0, "invoice_count": 0 },
  "top_dues": [{ "customer_id", "name", "balance" }],
  "low_stock": [{ "product_id", "name", "stock" }],
  "series_7d": [{ "date": "2026-11-19", "sales": 0 }],
  "series_30d": [{ "date": "2026-10-22", "sales": 0 }]
}
```

Dates are Asia/Kolkata. Sales are non-void invoice totals. Low stock is `stock <= reorder_level` (default 5). Not plan-gated.

### `GET /invoices/:id/events`

`{ "data": [{ "id", "invoice_id", "kind", "metadata", "created_at" }] }`.

`kind` is `created`, `sent`, `viewed`, `reminder_sent`, `payment_received`, `voided`, or `synced`. `viewed` is written when `GET /public/invoices/:token` opens, at most once per invoice per Kolkata day. `reminder_sent` is written when a reminder job is marked sent. The hourly reminder cron is unchanged and still requires `auto_reminders`.

### `GET /reminders/plan` and `PUT /reminders/plan`

```json
{ "channel": "whatsapp", "before_days": [3], "on_due": true, "after_days": [3, 7], "template": "Invoice {{number}} for {{total}}" }
```

Negative offsets are before the due date, `0` is on the due date, positive offsets are after. PUT replaces that channel's rows in `reminder_schedules` and requires `auto_reminders`. If `template` is omitted, the tenant `locale` (`en` or `bn`) supplies the default. `GET/PUT /reminders/schedules` (raw `offset_days`) still works.

### Ledger

- `POST /customers/:id/ledger-link` returns `{ token, customer_id, created_at, url }`. The token is 48 hex characters from `extensions.gen_random_bytes`, because hosted pgcrypto is not on the `public` search path. Creating a new link revokes the previous one. Billing role or higher.
- `POST /customers/:id/ledger-link/revoke` returns `{ revoked }`.
- `GET /public/ledger/:token` is anonymous. It returns that customer's shop branding, invoices, succeeded payments, and running balance. No other customer is included. A revoked or unknown token is 404.
- `POST /public/ledger/:token/upi` returns `{ balance, upi_uri, qr_svg, razorpay_available }` for the outstanding balance. No service-role key.

**Difference:** the public ledger does not create a Razorpay order. `razorpay_available` is true when the tenant has an enabled key id. Charging that order is still `POST /invoices/:id/razorpay`, which needs the service-role key to read the secret. UPI works without it, from `tenants.upi_vpa`.

### `POST /voice/parse`

`{ "text": "দুই কেজি চাল, পঞ্চাশ টাকা", "locale": "bn" }` or `{ "audio_base64", "locale" }`.

Response: `{ locale, provider, transcript, lines: [{ description, quantity, unit, unit_price, line_total, product_id }] }`.

Text is parsed on the server and matched to the tenant's products. No key required. Audio calls OpenAI Whisper when `OPENAI_API_KEY` is set (`SPEECH_PROVIDER` defaults to `openai`). Otherwise **503** `SPEECH_NOT_CONFIGURED`.

### `POST /purchases/parse`

`{ "image_base64", "filename" }` or `{ "text" }` for an extraction you already have.

Response: `{ supplier, lines: [{ description, quantity, unit_price, line_total }], total, provider }`.

**Difference:** the body is JSON, not multipart, and the image is not stored in a bucket. It is sent to the OCR provider. `OCR_PROVIDER=openai` (the default) needs `OPENAI_API_KEY`, or the route returns **503** `OCR_NOT_CONFIGURED`. `text` is parsed with no key. `OCR_PROVIDER=stub` returns a sample draft for tests.

### `GET /i18n/labels?locale=en|bn`

`{ "locale", "labels": { "invoice", "total", "pay_upi", "reminder", "balance", "thanks" } }`. Public. PDF title, total, and the UPI line use `tenants.locale` (`en` or `bn`).

## Round 3

`cursor/billflow-frontend-6380` did not yet contain a "Contracts needed from backend (round 3)" section when this was written. The shapes below follow the contract named in that request. Google sign-in is not part of this API.

Hosted SQL: `supabase/fixes/2026-11-20_admin_storage_templates.sql`. Safe to run again after the earlier 2026-11-20 fix scripts.

### Super admin

`GET /me` and `GET /auth/me` both return the profile plus `is_super_admin`. The flag is true only after `claim_platform_admin()` matches `auth.users.email` to `maheshpatra920@gmail.com` (or a row already in `platform_admins`). No password is stored. Every admin write is checked again inside a security-definer function and inserted into `audit_logs`.

| Route | Body |
|---|---|
| `GET /admin/plans` | |
| `PATCH /admin/plans/:code` | `name`, `description`, `price_monthly`, `price_yearly`, `price_monthly_paise`, `price_yearly_paise`, `active`, `is_public` |
| `GET /admin/plans/:code/features` | |
| `PUT /admin/plans/:code/features` | `{ "features": [{ "feature_key", "enabled", "limit_value" }] }` |
| `GET /admin/templates` | system invoice templates |
| `PUT /admin/templates/:key` | `name`, `description`, `required_feature`, `active` |
| `GET /admin/tenants` | |
| `POST /admin/tenants/:id/suspend` | `{ "status": "suspended" }` or `"active"` to undo |
| `POST /admin/tenants/:id/plan` | `{ "plan": "growth" }` |
| `GET /admin/settings` | `app_domain`, `dashboard_host` |
| `PATCH /admin/settings` | those two fields |

A non-admin receives 403. These routes use the caller's JWT, not the service-role key.

### Uploads

`POST /uploads/presign` with `{ "kind": "logo" | "avatar" | "bill_photo" | "product" | "site", "content_type", "size" }`.

`PATCH /admin/settings` accepts `storage_provider`: `supabase`, `cloudinary`, or `r2`. Supabase is the default. If the saved provider is not configured, presign uses Supabase. R2 is not selectable: `GET /admin/settings` always reports it `{ "configured": false, "available": false }`.

`GET /admin/settings` includes:

```json
{
  "storage_provider": "supabase",
  "storage": {
    "provider": "supabase",
    "providers": {
      "supabase": { "configured": true, "details": { "buckets": ["logos", "avatars", "bill-photos", "products", "site-images"], "public_url": "https://<project>.supabase.co/storage/v1/object/public/<bucket>/<path>" } },
      "cloudinary": { "configured": false, "available": true, "details": { "cloud_name": null, "api_key": null, "secret_set": false, "source": null, "folders": { "logos": "billflow/logos", "avatars": "billflow/avatars", "products": "billflow/products", "site": "billflow/site" } } },
      "r2": { "configured": false, "available": false }
    }
  }
}
```

`PATCH /admin/settings` also accepts `cloudinary`:

```json
{ "cloudinary": { "cloud_name": "your-cloud", "api_key": "your-key", "api_secret": "write-only" } }
```

`api_secret` is write-only. Omit it, or send `""`, to keep the current secret. Send `null` to clear it. The secret is never returned, logged, or seeded.

`GET /admin/settings` returns Cloudinary as:

```json
{
  "configured": true,
  "available": true,
  "details": {
    "cloud_name": "your-cloud",
    "api_key": "your-key",
    "secret_set": true,
    "source": "database",
    "folders": { "logos": "billflow/logos", "avatars": "billflow/avatars", "products": "billflow/products", "site": "billflow/site" }
  }
}
```

`source` is `database` when the cloud name, key, and secret all come from the database, `env` when env fills any gap and the result is complete, otherwise `null`. Database values win over `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`.

Selecting `storage_provider: "cloudinary"` returns **400** `STORAGE_PROVIDER_NOT_CONFIGURED` unless the cloud name, key, and secret are all set. A non-admin `PATCH` is **403**.

Presign still returns `{ provider, url, fields, public_url }` for Cloudinary. The signature is `sha1` of the alphabetically sorted `folder`, `public_id`, and `timestamp` string with the secret appended. That hash is computed in Postgres by `cloudinary_sign`. The secret is encrypted with `extensions.pgp_sym_encrypt` in the locked schema `billflow_private`. Supabase Vault is not used. No API role can read the ciphertext, and no `CLOUDINARY_SECRETS_KEY` is required. Database values override the env fallback. The API secret is never returned by `GET /admin/settings`.

A PUT upload returns `provider`, `url`, and `headers`. A multipart upload returns `provider`, `url`, and `fields`. Both include `public_url` when the object is public.

| Provider | Response | Where the file goes |
|---|---|---|
| `supabase` | `{ provider, url, headers, public_url, path }` | Signed upload URL. Public buckets `logos`, `avatars`, `products`, and `site-images`. Private `bill-photos` (`public_url` is null) and `invoice-pdfs`. Public URL is `{SUPABASE_URL}/storage/v1/object/public/{bucket}/{path}`. A tenant can only write under `{tenant_id}/`. |
| `cloudinary` | `{ provider, url, fields, public_url }` | `url` is `https://api.cloudinary.com/v1_1/{cloud}/image/upload`. `fields` are `api_key`, `timestamp`, `signature`, `folder`, `public_id`. Folders are `billflow/logos/{tenant_id}`, `billflow/avatars/{user_id}`, `billflow/bills/{tenant_id}`, `billflow/products/{tenant_id}`, and `billflow/site/{tenant_id}`. The API secret stays in Postgres. |
| `r2` | `{ provider, url, headers, public_url, key }` | Optional. Needs `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, and `R2_PUBLIC_BASE_URL`. |

Logo, avatar, product, and site images are png, jpeg, or webp up to 2 MB. A bill photo is an image or PDF up to 8 MB. `product` uploads go to public bucket `products` or Cloudinary folder `billflow/products/{tenant_id}`. `site` uploads (hero and about) go to public bucket `site-images` or `billflow/site/{tenant_id}`. The object key starts with `{tenant_id}/`. `PATCH /tenants/current` sets `logo_url`. `PATCH /me` and `PATCH /auth/me` set `avatar_url`. The logo is drawn on the PDF when `logo_url` is `https`, and the public ledger and shared invoice include it.

### Product images

`products.image_url` is nullable and must be `https` (or null). `POST /products` and `PUT /products/:id` accept `image_url`. An empty string clears it. `http` is **400**. `GET /products` returns `{ "data": [ product, ... ] }` and `GET /products/:id` returns one product. Both include `image_url`.

`GET /website` includes `products`: `[{ "id", "name", "price", "image_url" }]` for active products. `PUT /website/draft` accepts `hero_image_url` and `about_image_url` inside `overrides`. Both must be `https` or null. `POST /website/publish` copies those keys into `published_overrides`.

`GET /sites/resolve` (and `get_site_by_host`) adds them to the public shop payload:

```json
{
  "hero_image_url": "https://cdn.example.com/hero.jpg",
  "about_image_url": "https://cdn.example.com/about.jpg",
  "products": [{ "id": "uuid", "name": "Basmati rice 5kg", "price": 450, "image_url": "https://cdn.example.com/rice.jpg" }],
  "bestsellers": [{ "id": "uuid", "name": "Basmati rice 5kg", "price": 450, "image_url": null }]
}
```

`bestsellers` is at most 6 active products, ranked by quantity sold on non-void invoices in the last 30 days. A line matches `invoice_items.product_id`, or the product name when the line has no product id. If nothing sold in that window, the 6 newest active products are used. Unpublished hosts still return `site: null`.

Cloudinary env: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`. R2 is optional. Supabase Storage needs no extra key beyond `SUPABASE_URL`. If `storage_provider` is `r2` or `cloudinary` and that env is missing, presign uses Supabase instead of returning 503.

### Invoice templates

These are `invoice_templates`, not the storefront `templates` table.

`GET /invoice-templates` returns `{ "data": [{ "key", "name", "description", "required_feature", "required_plan", "entitled", "active" }] }`.

`classic` is entitled on every plan. `modern`, `minimal`, `bold`, `thermal_58`, `thermal_80`, and `bengali` require `custom_templates` (business). `required_plan` is `business` for those and null for classic.

`tenants.default_template` is the shop default (`PATCH /tenants/current`). `invoices.template_key` is optional (`PATCH /invoices/:id`). A locked key raises `FEATURE_LOCKED:custom_templates`. A null invoice key uses the tenant default, then classic.

PDF layout follows that key. `thermal_58` and `thermal_80` are narrow pages. `bengali` uses Hind Siliguri (`api/assets/fonts/HindSiliguri-Regular.ttf`, SIL Open Font License).

Every `/admin` route, including the reads, checks `is_platform_admin()` and returns **403** `platform admin required` for anyone else. The list and settings reads are security-definer functions that raise the same error, so a direct RPC from a shop owner is refused too. `POST /invoices` accepts `template_key`.
