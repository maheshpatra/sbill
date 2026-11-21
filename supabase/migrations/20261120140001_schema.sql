-- Billflow migration 2 of 4
-- Catalog, tenancy, billing documents. UUID primary keys, timestamptz, FKs.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.tenant_status as enum (
  'trialing', 'active', 'past_due', 'suspended', 'cancelled'
);

create type public.member_role as enum ('owner', 'admin', 'billing', 'member');

create type public.membership_status as enum ('active', 'invited', 'disabled');

create type public.billing_cycle as enum ('monthly', 'yearly');

create type public.subscription_status as enum (
  'trialing', 'active', 'past_due', 'cancelled', 'paused'
);

create type public.invoice_status as enum (
  'draft', 'sent', 'paid', 'overdue', 'void'
);

create type public.payment_method as enum (
  'upi', 'bank_transfer', 'cash', 'card', 'cheque', 'other'
);

create type public.payment_status as enum (
  'pending', 'succeeded', 'failed', 'refunded'
);

create type public.tax_type as enum (
  'gst', 'igst', 'cgst', 'sgst', 'exempt', 'custom'
);

create type public.supply_type as enum ('intra', 'inter');

-- ---------------------------------------------------------------------------
-- Platform + plan catalog (not tenant-scoped)
-- ---------------------------------------------------------------------------

create table public.platform_settings (
  id integer primary key check (id = 1),
  app_domain text not null default 'billflow.app',
  dashboard_host text not null default 'app.billflow.app',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.platform_settings (id) values (1);

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text not null default '',
  price_monthly numeric(12, 2) not null check (price_monthly >= 0),
  price_yearly numeric(12, 2) not null check (price_yearly >= 0),
  currency char(3) not null default 'INR',
  features jsonb not null default '{}'::jsonb,
  is_public boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plans_code_format check (code ~ '^[a-z0-9_]+$'),
  constraint plans_currency_len check (char_length(currency) = 3)
);

insert into public.plans (
  id, code, name, description, price_monthly, price_yearly, features, sort_order
) values
  (
    '10000000-0000-4000-8000-000000000001',
    'starter',
    'Starter',
    'For a new practice or shop sending its first GST invoices.',
    0,
    0,
    jsonb_build_object(
      'invoices_per_month', 20,
      'customers', 50,
      'members', 2,
      'custom_domain', false,
      'upi_qr', true,
      'gst_invoices', true,
      'webhooks', false,
      'audit_log', false,
      'remove_branding', false,
      'api_access', false,
      'public_site', true
    ),
    10
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    'growth',
    'Growth',
    'For a busy team that needs webhooks, a longer audit trail, and more invoices.',
    1499,
    14990,
    jsonb_build_object(
      'invoices_per_month', 200,
      'customers', 1000,
      'members', 10,
      'custom_domain', false,
      'upi_qr', true,
      'gst_invoices', true,
      'webhooks', true,
      'audit_log', true,
      'remove_branding', false,
      'api_access', true,
      'public_site', true
    ),
    20
  ),
  (
    '10000000-0000-4000-8000-000000000003',
    'pro',
    'Pro',
    'Unlimited documents, a custom domain, and branding removed from the public site.',
    4999,
    49990,
    jsonb_build_object(
      'invoices_per_month', null,
      'customers', null,
      'members', null,
      'custom_domain', true,
      'upi_qr', true,
      'gst_invoices', true,
      'webhooks', true,
      'audit_log', true,
      'remove_branding', true,
      'api_access', true,
      'public_site', true
    ),
    30
  );

-- ---------------------------------------------------------------------------
-- Tenants and people
-- ---------------------------------------------------------------------------

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text,
  slug text not null unique,
  plan text not null default 'starter' references public.plans (code),
  status public.tenant_status not null default 'trialing',
  gstin text,
  pan text,
  email text,
  phone text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  state_code text,
  pincode text,
  country text not null default 'IN',
  upi_vpa text,
  logo_url text,
  invoice_prefix text not null default 'INV',
  currency char(3) not null default 'INR',
  timezone text not null default 'Asia/Kolkata',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenants_name_len check (char_length(btrim(name)) >= 2),
  constraint tenants_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint tenants_currency_len check (char_length(currency) = 3),
  constraint tenants_gstin_format check (
    gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'
  ),
  constraint tenants_email_format check (
    email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  )
);

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  name text,
  -- Active membership, denormalised so the requested users columns exist.
  -- Source of truth for "which tenants" is public.memberships.
  tenant_id uuid references public.tenants (id) on delete set null,
  active_tenant_id uuid references public.tenants (id) on delete set null,
  role public.member_role,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_email_format check (
    email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  )
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  role public.member_role not null,
  status public.membership_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint memberships_unique_user unique (tenant_id, user_id)
);

create index memberships_user_idx on public.memberships (user_id, status);
create index memberships_tenant_idx on public.memberships (tenant_id, role);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  email text not null,
  role public.member_role not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  invited_by uuid references public.users (id) on delete set null,
  expires_at timestamptz not null default (now() + interval '14 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invitations_email_format check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint invitations_not_owner check (role <> 'owner')
);

create unique index invitations_pending_email
  on public.invitations (tenant_id, lower(email))
  where status = 'pending';

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants (id) on delete cascade,
  custom_domain text,
  published boolean not null default false,
  title text,
  tagline text,
  about text,
  theme jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sites_domain_format check (
    custom_domain is null or custom_domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'
  )
);

create unique index sites_custom_domain_unique
  on public.sites (lower(custom_domain))
  where custom_domain is not null;

-- ---------------------------------------------------------------------------
-- Billing relationship (Billflow subscription of the tenant)
-- ---------------------------------------------------------------------------

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  plan_id uuid references public.plans (id),
  plan_name text not null,
  price numeric(12, 2) not null check (price >= 0),
  currency char(3) not null default 'INR',
  billing_cycle public.billing_cycle not null,
  status public.subscription_status not null default 'trialing',
  start_date date not null default current_date,
  end_date date,
  current_period_start date,
  current_period_end date,
  cancel_at_period_end boolean not null default false,
  provider text not null default 'manual',
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_currency_len check (char_length(currency) = 3),
  constraint subscriptions_period check (
    end_date is null or start_date is null or end_date >= start_date
  )
);

create index subscriptions_tenant_idx on public.subscriptions (tenant_id, status);

create unique index subscriptions_one_open_per_tenant
  on public.subscriptions (tenant_id)
  where status in ('trialing', 'active', 'past_due', 'paused');

-- ---------------------------------------------------------------------------
-- The tenant's own clients and tax setup
-- ---------------------------------------------------------------------------

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  email text,
  phone text,
  company text,
  gstin text,
  billing_address jsonb not null default '{}'::jsonb,
  shipping_address jsonb not null default '{}'::jsonb,
  notes text,
  currency char(3) not null default 'INR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_name_len check (char_length(btrim(name)) >= 1),
  constraint customers_currency_len check (char_length(currency) = 3),
  constraint customers_gstin_format check (
    gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'
  ),
  constraint customers_email_format check (
    email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  )
);

create index customers_tenant_idx on public.customers (tenant_id, name);
create index customers_tenant_email_idx on public.customers (tenant_id, lower(email));

create table public.tax_rates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  rate numeric(6, 3) not null check (rate >= 0 and rate <= 100),
  tax_type public.tax_type not null default 'gst',
  is_default boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tax_rates_unique_name unique (tenant_id, name)
);

create index tax_rates_tenant_idx on public.tax_rates (tenant_id) where active;

create table public.invoice_counters (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  prefix text not null default 'INV',
  next_number integer not null default 1 check (next_number > 0),
  pad integer not null default 4 check (pad between 1 and 12),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Invoices, lines, payments
-- ---------------------------------------------------------------------------

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete restrict,
  number text not null,
  amount numeric(12, 2) not null default 0 check (amount >= 0),
  tax numeric(12, 2) not null default 0 check (tax >= 0),
  discount numeric(12, 2) not null default 0 check (discount >= 0),
  total numeric(12, 2) not null default 0 check (total >= 0),
  status public.invoice_status not null default 'draft',
  supply_type public.supply_type not null default 'intra',
  place_of_supply text,
  currency char(3) not null default 'INR',
  issued_at timestamptz,
  due_at timestamptz,
  paid_at timestamptz,
  notes text,
  terms text,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoices_number_unique_per_tenant unique (tenant_id, number),
  constraint invoices_currency_len check (char_length(currency) = 3),
  constraint invoices_number_len check (char_length(btrim(number)) >= 1)
);

create index invoices_tenant_status_idx on public.invoices (tenant_id, status, created_at desc);
create index invoices_tenant_customer_idx on public.invoices (tenant_id, customer_id);
create index invoices_due_idx on public.invoices (status, due_at) where status = 'sent';

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  description text not null,
  quantity numeric(12, 3) not null check (quantity > 0),
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  tax_rate_id uuid references public.tax_rates (id) on delete set null,
  tax_rate numeric(6, 3) not null default 0 check (tax_rate >= 0 and tax_rate <= 100),
  hsn_sac text,
  line_subtotal numeric(12, 2) not null default 0 check (line_subtotal >= 0),
  cgst_amount numeric(12, 2) not null default 0 check (cgst_amount >= 0),
  sgst_amount numeric(12, 2) not null default 0 check (sgst_amount >= 0),
  igst_amount numeric(12, 2) not null default 0 check (igst_amount >= 0),
  tax_amount numeric(12, 2) not null default 0 check (tax_amount >= 0),
  line_total numeric(12, 2) not null default 0 check (line_total >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_items_description_len check (char_length(btrim(description)) >= 1)
);

create index invoice_items_invoice_idx on public.invoice_items (invoice_id, sort_order);
create index invoice_items_tenant_idx on public.invoice_items (tenant_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete restrict,
  amount numeric(12, 2) not null check (amount > 0),
  method public.payment_method not null,
  status public.payment_status not null default 'succeeded',
  transaction_ref text,
  notes text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index payments_invoice_idx on public.payments (invoice_id, status);
create index payments_tenant_idx on public.payments (tenant_id, paid_at desc);

create unique index payments_tenant_ref_unique
  on public.payments (tenant_id, transaction_ref)
  where transaction_ref is not null and btrim(transaction_ref) <> '';

-- ---------------------------------------------------------------------------
-- Webhooks, audit
-- ---------------------------------------------------------------------------

create table public.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  url text not null,
  secret text not null,
  events text[] not null default array['invoice.paid', 'invoice.sent']::text[],
  active boolean not null default true,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint webhook_url_format check (url ~* '^https?://'),
  constraint webhook_secret_len check (char_length(secret) >= 16)
);

create index webhook_endpoints_tenant_idx on public.webhook_endpoints (tenant_id) where active;

create table public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  endpoint_id uuid not null references public.webhook_endpoints (id) on delete cascade,
  event text not null,
  payload jsonb not null,
  status text not null default 'queued' check (status in ('queued', 'succeeded', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  response_status integer,
  response_body text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index webhook_deliveries_endpoint_idx
  on public.webhook_deliveries (endpoint_id, created_at desc);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  actor_id uuid references public.users (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_tenant_idx on public.audit_logs (tenant_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);

comment on table public.tenants is 'A Billflow customer organisation (the SaaS tenant).';
comment on table public.users is 'Profile for auth.users. tenant_id/role mirror the active membership.';
comment on table public.memberships is 'Source of truth for which users belong to which tenant and with what role.';
comment on table public.customers is 'The tenant''s own clients, the parties that receive invoices.';
comment on table public.invoice_counters is 'Per-tenant invoice number sequence.';
comment on table public.plans is 'Billflow plan catalog. features jsonb holds entitlement keys.';
