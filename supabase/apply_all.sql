-- Billflow migration 1 of 4
-- Supersede the earlier minimal draft (public.tenants, public.users,
-- current_tenant_id, current_user_role, and any policies on those tables).
-- The target project has no real data, so dropping those objects is safe.
-- Every drop is conditional so this also runs on an empty project.
--
-- Re-running the whole migration set is supported: objects created by later
-- Billflow migrations are dropped here as well.

do $$
begin
  if to_regclass('auth.users') is not null then
    execute 'drop trigger if exists on_auth_user_created on auth.users';
  end if;
end $$;

drop view if exists public.invoice_balances cascade;

do $$
declare
  r record;
begin
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        'current_tenant_id',
        'current_user_role',
        'create_tenant',
        'set_active_tenant',
        'handle_new_user',
        'set_updated_at',
        'custom_access_token_hook',
        'get_site_by_host',
        'is_member_of',
        'shares_active_tenant',
        'has_billing_access',
        'has_admin_access',
        'next_invoice_number',
        'mark_overdue_invoices',
        'sync_user_active_membership',
        'assign_invoice_defaults',
        'compute_item_amounts',
        'touch_invoice_totals',
        'enforce_invoice_transition',
        'guard_payment',
        'sync_invoice_payment_status',
        'protect_last_owner',
        'audit_row',
        'has_feature',
        'feature_limit',
        'effective_plan_id',
        'tenant_entitlements',
        'required_plan',
        'usage_exceeds_plan',
        'apply_plan_transitions',
        'assert_not_over_limit',
        'enforce_product_entitlement',
        'enforce_invoice_entitlement',
        'enforce_line_entitlement',
        'enforce_domain_entitlement',
        'enforce_template_entitlement',
        'enforce_site_domain',
        'enforce_over_limit_insert',
        'sync_subscription_to_tenant',
        'sync_tenant_to_subscription',
        'confirm_upi_payment',
        'void_upi_payment',
        'pos_checkout'
      ])
  loop
    execute format('drop function if exists public.%I(%s) cascade', r.proname, r.args);
  end loop;
end $$;

-- Unknown draft policy names: drop every policy on the draft tables before
-- the tables themselves go away.
do $$
declare
  r record;
begin
  for r in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename = any (array[
        'tenants', 'users', 'memberships', 'plans', 'subscriptions',
        'customers', 'tax_rates', 'invoice_counters', 'invoices',
        'invoice_items', 'payments', 'audit_logs', 'sites', 'invitations',
        'webhook_endpoints', 'webhook_deliveries', 'platform_settings',
        'tenant_domains', 'tenant_template_settings', 'templates',
        'invoice_shares', 'message_logs', 'whatsapp_settings', 'messaging_settings',
        'reminder_schedules', 'reminder_jobs', 'products', 'pos_settings', 'invoice_fy_counters',
        'tenant_subscriptions', 'tenant_feature_overrides', 'plan_features', 'features',
        'tenant_razorpay', 'tenant_gateway_events',
        'platform_invoices', 'billing_checkouts', 'billing_events'
      ])
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

drop table if exists public.webhook_deliveries cascade;
drop table if exists public.webhook_endpoints cascade;
drop table if exists public.payments cascade;
drop table if exists public.invoice_items cascade;
drop table if exists public.invoices cascade;
drop table if exists public.invoice_counters cascade;
drop table if exists public.tax_rates cascade;
drop table if exists public.customers cascade;
drop table if exists public.tenant_gateway_events cascade;
drop table if exists public.tenant_razorpay cascade;
drop table if exists public.billing_events cascade;
drop table if exists public.billing_checkouts cascade;
drop table if exists public.platform_invoices cascade;
drop table if exists public.tenant_feature_overrides cascade;
drop table if exists public.tenant_subscriptions cascade;
drop table if exists public.plan_features cascade;
drop table if exists public.features cascade;
drop table if exists public.subscriptions cascade;
drop table if exists public.invitations cascade;
drop table if exists public.reminder_jobs cascade;
drop table if exists public.reminder_schedules cascade;
drop table if exists public.message_logs cascade;
drop table if exists public.invoice_shares cascade;
drop table if exists public.whatsapp_settings cascade;
drop table if exists public.messaging_settings cascade;
drop table if exists public.products cascade;
drop table if exists public.pos_settings cascade;
drop table if exists public.invoice_fy_counters cascade;
drop table if exists public.tenant_domains cascade;
drop table if exists public.tenant_template_settings cascade;
drop table if exists public.templates cascade;
drop table if exists public.sites cascade;
drop table if exists public.audit_logs cascade;
drop table if exists public.memberships cascade;
drop table if exists public.users cascade;
drop table if exists public.tenants cascade;
drop table if exists public.plans cascade;
drop table if exists public.platform_settings cascade;

drop type if exists public.supply_type cascade;
drop type if exists public.membership_status cascade;
drop type if exists public.tax_type cascade;
drop type if exists public.payment_status cascade;
drop type if exists public.payment_method cascade;
drop type if exists public.invoice_status cascade;
drop type if exists public.subscription_status cascade;
drop type if exists public.billing_cycle cascade;
drop type if exists public.member_role cascade;
drop type if exists public.tenant_status cascade;
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
-- Billflow migration 3 of 4
-- Triggers, invoice math, auth integration, RPCs.
-- Helper functions used by RLS are SECURITY DEFINER with a locked search_path
-- so policies do not recurse into themselves.

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'platform_settings', 'plans', 'tenants', 'users', 'memberships',
    'invitations', 'sites', 'subscriptions', 'customers', 'tax_rates',
    'invoices', 'invoice_items', 'payments', 'webhook_endpoints',
    'webhook_deliveries'
  ]
  loop
    execute format(
      'drop trigger if exists %I on public.%I',
      t || '_set_updated_at',
      t
    );
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      t || '_set_updated_at',
      t
    );
  end loop;
end $$;

create or replace function public.touch_invoice_counter_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists invoice_counters_set_updated_at on public.invoice_counters;
create trigger invoice_counters_set_updated_at
  before update on public.invoice_counters
  for each row execute function public.touch_invoice_counter_updated_at();

-- ---------------------------------------------------------------------------
-- Auth profile
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, name)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'name',
      new.raw_user_meta_data ->> 'full_name',
      split_part(coalesce(new.email, 'user'), '@', 1)
    )
  )
  on conflict (id) do update
    set email = excluded.email,
        name = coalesce(public.users.name, excluded.name);
  return new;
end;
$$;

do $$
begin
  if to_regclass('auth.users') is null then
    raise exception
      'auth.users is missing. Supabase provides it. Local tests must apply supabase/tests/00_stub_auth.sql first.';
  end if;
  execute 'drop trigger if exists on_auth_user_created on auth.users';
  execute 'create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user()';
end $$;

-- ---------------------------------------------------------------------------
-- Tenant context. Membership is the source of truth.
-- A JWT tenant_id claim (custom access token hook) only selects WHICH
-- membership to use. It never grants access by itself.
-- ---------------------------------------------------------------------------

create or replace function public.current_tenant_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  claim text;
  claim_tenant uuid;
  active uuid;
begin
  if uid is null then
    return null;
  end if;

  claim := nullif(current_setting('request.jwt.claim.tenant_id', true), '');
  if claim is null or claim = '' then
    begin
      claim := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'tenant_id';
    exception
      when others then
        claim := null;
    end;
  end if;

  if claim is not null then
    begin
      claim_tenant := claim::uuid;
    exception
      when invalid_text_representation then
        claim_tenant := null;
    end;
  end if;

  if claim_tenant is not null and exists (
    select 1
    from public.memberships m
    where m.user_id = uid
      and m.tenant_id = claim_tenant
      and m.status = 'active'
  ) then
    return claim_tenant;
  end if;

  select u.active_tenant_id
    into active
  from public.users u
  where u.id = uid;

  if active is not null and exists (
    select 1
    from public.memberships m
    where m.user_id = uid
      and m.tenant_id = active
      and m.status = 'active'
  ) then
    return active;
  end if;

  select m.tenant_id
    into active
  from public.memberships m
  where m.user_id = uid
    and m.status = 'active'
  order by m.created_at asc
  limit 1;

  return active;
end;
$$;

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select m.role::text
  from public.memberships m
  where m.user_id = auth.uid()
    and m.tenant_id = public.current_tenant_id()
    and m.status = 'active'
  limit 1;
$$;

create or replace function public.is_member_of(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.tenant_id = p_tenant
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

create or replace function public.shares_active_tenant(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.user_id = p_user
      and m.tenant_id = public.current_tenant_id()
      and m.status = 'active'
  );
$$;

create or replace function public.has_billing_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() in ('owner', 'admin', 'billing');
$$;

create or replace function public.has_admin_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() in ('owner', 'admin');
$$;

-- ---------------------------------------------------------------------------
-- Keep users.tenant_id / users.role aligned with the active membership
-- ---------------------------------------------------------------------------

create or replace function public.sync_user_active_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := coalesce(new.user_id, old.user_id);
  active uuid;
  rol public.member_role;
begin
  select u.active_tenant_id into active from public.users u where u.id = uid;

  if active is null or not exists (
    select 1 from public.memberships m
    where m.user_id = uid and m.tenant_id = active and m.status = 'active'
  ) then
    select m.tenant_id into active
    from public.memberships m
    where m.user_id = uid and m.status = 'active'
    order by m.created_at asc
    limit 1;
  end if;

  select m.role into rol
  from public.memberships m
  where m.user_id = uid and m.tenant_id = active and m.status = 'active';

  update public.users
     set active_tenant_id = active,
         tenant_id = active,
         role = rol
   where id = uid;

  return coalesce(new, old);
end;
$$;

drop trigger if exists memberships_sync_user on public.memberships;
create trigger memberships_sync_user
  after insert or update or delete on public.memberships
  for each row execute function public.sync_user_active_membership();

create or replace function public.protect_last_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owners integer;
  tid uuid := old.tenant_id;
begin
  if old.role = 'owner' and old.status = 'active' then
    if tg_op = 'DELETE'
       or new.role is distinct from 'owner'
       or new.status is distinct from 'active'
       or new.tenant_id is distinct from old.tenant_id
    then
      select count(*) into owners
      from public.memberships m
      where m.tenant_id = tid
        and m.role = 'owner'
        and m.status = 'active'
        and m.id <> old.id;
      if owners < 1 then
        raise exception 'tenant must keep an active owner' using errcode = '23514';
      end if;
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists memberships_protect_last_owner on public.memberships;
create trigger memberships_protect_last_owner
  before update or delete on public.memberships
  for each row execute function public.protect_last_owner();

-- ---------------------------------------------------------------------------
-- Invoice numbers and totals
-- ---------------------------------------------------------------------------

create or replace function public.next_invoice_number(p_tenant uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  prefix text;
  n integer;
  pad integer;
begin
  insert into public.invoice_counters (tenant_id)
  values (p_tenant)
  on conflict (tenant_id) do nothing;

  update public.invoice_counters
     set next_number = next_number + 1
   where tenant_id = p_tenant
  returning invoice_counters.prefix, next_number - 1, invoice_counters.pad
    into prefix, n, pad;

  return prefix || '-' || lpad(n::text, pad, '0');
end;
$$;

create or replace function public.assign_invoice_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.number is null or btrim(new.number) = '' then
    new.number := public.next_invoice_number(new.tenant_id);
  end if;
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists invoices_assign_defaults on public.invoices;
create trigger invoices_assign_defaults
  before insert on public.invoices
  for each row execute function public.assign_invoice_defaults();

create or replace function public.compute_item_amounts()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  tid uuid;
  supply public.supply_type;
  rate numeric(6, 3);
begin
  select i.tenant_id, i.supply_type
    into tid, supply
  from public.invoices i
  where i.id = new.invoice_id;

  if tid is null then
    raise exception 'invoice not found' using errcode = '23503';
  end if;

  new.tenant_id := tid;

  if new.tax_rate_id is not null then
    select tr.rate into rate
    from public.tax_rates tr
    where tr.id = new.tax_rate_id
      and tr.tenant_id = tid;
    if rate is null then
      raise exception 'tax rate not found for this tenant' using errcode = '23503';
    end if;
    new.tax_rate := rate;
  end if;

  new.line_subtotal := round(new.quantity * new.unit_price, 2);
  new.tax_amount := round(new.line_subtotal * coalesce(new.tax_rate, 0) / 100.0, 2);

  if supply = 'inter' then
    new.igst_amount := new.tax_amount;
    new.cgst_amount := 0;
    new.sgst_amount := 0;
  else
    new.cgst_amount := round(new.tax_amount / 2, 2);
    new.sgst_amount := new.tax_amount - new.cgst_amount;
    new.igst_amount := 0;
  end if;

  new.line_total := new.line_subtotal + new.tax_amount;
  return new;
end;
$$;

drop trigger if exists invoice_items_compute on public.invoice_items;
create trigger invoice_items_compute
  before insert or update on public.invoice_items
  for each row execute function public.compute_item_amounts();

create or replace function public.enforce_invoice_transition()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  subtotal numeric(12, 2);
  tax_sum numeric(12, 2);
  paid numeric(12, 2);
  allowed text[];
begin
  select coalesce(sum(line_subtotal), 0), coalesce(sum(tax_amount), 0)
    into subtotal, tax_sum
  from public.invoice_items
  where invoice_id = new.id;

  new.amount := subtotal;
  new.tax := tax_sum;
  new.total := round(new.amount + new.tax - coalesce(new.discount, 0), 2);

  if new.total < 0 then
    raise exception 'discount exceeds the invoice taxable value' using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' then
    if new.number is distinct from old.number then
      raise exception 'invoice number is immutable' using errcode = '23514';
    end if;
    if new.tenant_id is distinct from old.tenant_id then
      raise exception 'tenant_id is immutable' using errcode = '23514';
    end if;
    if old.status <> 'draft' and new.customer_id is distinct from old.customer_id then
      raise exception 'customer cannot change after the invoice leaves draft'
        using errcode = '23514';
    end if;

    if new.status is distinct from old.status then
      allowed := case old.status
        when 'draft' then array['draft', 'sent', 'void', 'paid']
        when 'sent' then array['sent', 'overdue', 'paid', 'void']
        when 'overdue' then array['overdue', 'sent', 'paid', 'void']
        when 'paid' then array['paid', 'void', 'sent', 'overdue']
        else array['void']
      end;
      if not (new.status::text = any (allowed)) then
        raise exception 'invalid invoice status transition from % to %', old.status, new.status
          using errcode = '23514';
      end if;
    end if;

    if new.status = 'sent' and old.status = 'draft' then
      new.issued_at := coalesce(new.issued_at, now());
      new.due_at := coalesce(new.due_at, now() + interval '15 days');
    end if;

    select coalesce(sum(amount), 0) into paid
    from public.payments
    where invoice_id = new.id
      and status = 'succeeded';

    if new.status = 'paid' and old.status is distinct from 'paid' then
      if paid < new.total then
        raise exception 'payments do not cover the invoice total' using errcode = '23514';
      end if;
      new.paid_at := coalesce(new.paid_at, now());
    end if;

    if old.status = 'paid' and new.status in ('sent', 'overdue') and paid >= new.total then
      raise exception 'invoice is fully paid' using errcode = '23514';
    end if;

    if new.status = 'void' and old.status is distinct from 'void' then
      if exists (
        select 1 from public.payments
        where invoice_id = new.id and status = 'succeeded'
      ) then
        raise exception 'refund payments before voiding an invoice' using errcode = '23514';
      end if;
    end if;

    if new.status is distinct from 'paid' then
      if old.status = 'paid' and new.status <> 'paid' then
        new.paid_at := null;
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists invoices_enforce_transition on public.invoices;
create trigger invoices_enforce_transition
  before update on public.invoices
  for each row execute function public.enforce_invoice_transition();

create or replace function public.touch_invoice_totals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  inv uuid := coalesce(new.invoice_id, old.invoice_id);
begin
  update public.invoices
     set updated_at = now()
   where id = inv;
  return coalesce(new, old);
end;
$$;

drop trigger if exists invoice_items_touch_invoice on public.invoice_items;
create trigger invoice_items_touch_invoice
  after insert or update or delete on public.invoice_items
  for each row execute function public.touch_invoice_totals();

create or replace function public.guard_payment()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  inv_tenant uuid;
  inv_status public.invoice_status;
  inv_total numeric(12, 2);
  already numeric(12, 2);
begin
  select i.tenant_id, i.status, i.total
    into inv_tenant, inv_status, inv_total
  from public.invoices i
  where i.id = new.invoice_id;

  if inv_tenant is null then
    raise exception 'invoice not found' using errcode = '23503';
  end if;
  if inv_status = 'void' then
    raise exception 'cannot record a payment against a void invoice' using errcode = '23514';
  end if;

  new.tenant_id := inv_tenant;
  if new.paid_at is null and new.status = 'succeeded' then
    new.paid_at := now();
  end if;

  if new.status = 'succeeded' then
    select coalesce(sum(amount), 0) into already
    from public.payments
    where invoice_id = new.invoice_id
      and status = 'succeeded'
      and id <> new.id;
    if already + new.amount > inv_total + 0.001 then
      raise exception 'payment exceeds the invoice balance' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists payments_guard on public.payments;
create trigger payments_guard
  before insert or update on public.payments
  for each row execute function public.guard_payment();

create or replace function public.sync_invoice_payment_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  inv uuid := coalesce(new.invoice_id, old.invoice_id);
  paid numeric(12, 2);
  tot numeric(12, 2);
  st public.invoice_status;
  stamp timestamptz := now();
begin
  if tg_op <> 'DELETE' and new.paid_at is not null then
    stamp := new.paid_at;
  end if;

  select coalesce(sum(amount), 0) into paid
  from public.payments
  where invoice_id = inv
    and status = 'succeeded';

  select total, status into tot, st
  from public.invoices
  where id = inv;

  if st = 'void' then
    return coalesce(new, old);
  end if;

  if tot is not null and paid >= tot then
    update public.invoices
       set status = 'paid',
           paid_at = coalesce(paid_at, stamp)
     where id = inv
       and status is distinct from 'paid';
  elsif st = 'paid' and paid < tot then
    update public.invoices
       set status = case when due_at is not null and due_at < now() then 'overdue'::public.invoice_status else 'sent'::public.invoice_status end,
           paid_at = null
     where id = inv;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists payments_sync_invoice on public.payments;
create trigger payments_sync_invoice
  after insert or update or delete on public.payments
  for each row execute function public.sync_invoice_payment_status();

-- ---------------------------------------------------------------------------
-- Audit (append-only, written by the definer so callers need no insert grant)
-- ---------------------------------------------------------------------------

create or replace function public.audit_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  row_id uuid;
  tid uuid;
  payload jsonb;
begin
  if tg_op = 'DELETE' then
    payload := to_jsonb(old);
  else
    payload := to_jsonb(new);
  end if;

  row_id := nullif(payload ->> 'id', '')::uuid;
  if tg_table_name = 'tenants' then
    tid := row_id;
  else
    tid := nullif(payload ->> 'tenant_id', '')::uuid;
  end if;

  if tid is not null then
    insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
    values (tid, auth.uid(), lower(tg_op), tg_table_name, row_id, payload);
  end if;

  return coalesce(new, old);
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['tenants', 'customers', 'invoices', 'payments', 'subscriptions', 'memberships']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row()',
      t || '_audit',
      t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Onboarding RPC
-- ---------------------------------------------------------------------------

create or replace function public.create_tenant(p_name text, p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  t public.tenants;
  m public.memberships;
  plan_id uuid;
  reserved text[] := array['www', 'app', 'api', 'billing', 'admin', 'static', 'dashboard', 'auth', 'mail'];
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if not exists (select 1 from public.users where id = uid) then
    insert into public.users (id, email, name)
    select u.id,
           u.email,
           coalesce(u.raw_user_meta_data ->> 'name', u.raw_user_meta_data ->> 'full_name', split_part(u.email, '@', 1))
    from auth.users u
    where u.id = uid;
  end if;

  if p_name is null or char_length(btrim(p_name)) < 2 then
    raise exception 'name must be at least 2 characters' using errcode = '22023';
  end if;
  if p_slug is null or p_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'slug must be lowercase kebab-case' using errcode = '22023';
  end if;
  if p_slug = any (reserved) then
    raise exception 'slug is reserved' using errcode = '22023';
  end if;

  insert into public.tenants (name, slug, plan, status, currency)
  values (btrim(p_name), p_slug, 'starter', 'trialing', 'INR')
  returning * into t;

  insert into public.memberships (tenant_id, user_id, role, status)
  values (t.id, uid, 'owner', 'active')
  returning * into m;

  update public.users
     set active_tenant_id = t.id,
         tenant_id = t.id,
         role = 'owner'
   where id = uid;

  insert into public.invoice_counters (tenant_id, prefix, next_number)
  values (t.id, 'INV', 1);

  insert into public.tax_rates (tenant_id, name, rate, tax_type, is_default)
  values
    (t.id, 'GST 0%', 0, 'exempt', false),
    (t.id, 'GST 5%', 5, 'gst', false),
    (t.id, 'GST 12%', 12, 'gst', false),
    (t.id, 'GST 18%', 18, 'gst', true),
    (t.id, 'GST 28%', 28, 'gst', false);

  select id into plan_id from public.plans where code = 'starter';

  insert into public.subscriptions (
    tenant_id, plan_id, plan_name, price, currency, billing_cycle, status,
    start_date, current_period_start, current_period_end
  ) values (
    t.id, plan_id, 'Starter', 0, 'INR', 'monthly', 'trialing',
    current_date, current_date, current_date + 14
  );

  insert into public.sites (tenant_id, title, tagline, published)
  values (t.id, btrim(p_name), 'Invoices and payments', false);

  return jsonb_build_object(
    'id', t.id,
    'name', t.name,
    'slug', t.slug,
    'plan', t.plan,
    'status', t.status,
    'currency', t.currency,
    'role', 'owner',
    'membership_id', m.id,
    'created_at', t.created_at
  );
end;
$$;

create or replace function public.set_active_tenant(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  rol public.member_role;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select m.role into rol
  from public.memberships m
  where m.user_id = uid
    and m.tenant_id = p_tenant_id
    and m.status = 'active';

  if rol is null then
    raise exception 'not a member of this tenant' using errcode = '42501';
  end if;

  update public.users
     set active_tenant_id = p_tenant_id,
         tenant_id = p_tenant_id,
         role = rol
   where id = uid;

  return jsonb_build_object(
    'tenant_id', p_tenant_id,
    'role', rol
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Public site lookup. Published sites only.
-- Matches custom_domain, "{slug}.{app_domain}", "{slug}.localhost", or a bare slug.
-- ---------------------------------------------------------------------------

create or replace function public.get_site_by_host(p_host text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  h text := lower(split_part(coalesce(p_host, ''), ':', 1));
  app_domain text;
  rec record;
begin
  if h = '' then
    return null;
  end if;
  h := rtrim(h, '.');

  select s.app_domain into app_domain from public.platform_settings s where s.id = 1;
  app_domain := lower(coalesce(app_domain, 'billflow.app'));

  select
    site.tenant_id,
    t.slug,
    t.name,
    t.logo_url,
    t.currency,
    site.title,
    site.tagline,
    site.about,
    site.custom_domain,
    site.published,
    site.theme
  into rec
  from public.sites site
  join public.tenants t on t.id = site.tenant_id
  where site.published = true
    and (
      lower(site.custom_domain) = h
      or lower(t.slug) = h
      or lower(t.slug) || '.' || app_domain = h
      or lower(t.slug) || '.localhost' = h
    )
  order by
    case when lower(site.custom_domain) = h then 0 else 1 end
  limit 1;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'tenant_id', rec.tenant_id,
    'slug', rec.slug,
    'name', rec.name,
    'title', rec.title,
    'tagline', rec.tagline,
    'about', rec.about,
    'logo_url', rec.logo_url,
    'custom_domain', rec.custom_domain,
    'published', rec.published,
    'theme', rec.theme,
    'currency', rec.currency,
    'host', h
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Cron: flip sent invoices past due_at to overdue. service_role only.
-- ---------------------------------------------------------------------------

create or replace function public.mark_overdue_invoices()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update public.invoices
     set status = 'overdue'
   where status = 'sent'
     and due_at is not null
     and due_at < now();
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Custom access token hook
-- Dashboard: Authentication → Hooks → Custom Access Token
--          → public.custom_access_token_hook
-- Adds tenant_id and user_role to the JWT. RLS still checks membership.
-- ---------------------------------------------------------------------------

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  claims jsonb;
  uid uuid;
  tid uuid;
  rol text;
begin
  uid := (event ->> 'user_id')::uuid;
  claims := coalesce(event -> 'claims', '{}'::jsonb);

  select m.tenant_id, m.role::text
    into tid, rol
  from public.memberships m
  join public.users u on u.id = m.user_id
  where m.user_id = uid
    and m.status = 'active'
  order by (m.tenant_id = u.active_tenant_id) desc, m.created_at asc
  limit 1;

  if tid is not null then
    claims := jsonb_set(claims, '{tenant_id}', to_jsonb(tid::text), true);
    claims := jsonb_set(claims, '{user_role}', to_jsonb(rol), true);
    claims := jsonb_set(
      claims,
      '{app_metadata}',
      coalesce(claims -> 'app_metadata', '{}'::jsonb)
        || jsonb_build_object('tenant_id', tid::text, 'user_role', rol),
      true
    );
  else
    claims := claims - 'tenant_id' - 'user_role';
  end if;

  return jsonb_set(event, '{claims}', claims, true);
end;
$$;

comment on function public.create_tenant(text, text) is
  'Creates a tenant, owner membership, starter subscription, GST rates, invoice counter, and unpublished site. Returns jsonb {id,name,slug,plan,status,currency,role,membership_id,created_at}.';
comment on function public.get_site_by_host(text) is
  'Resolves a published tenant site by custom domain, slug.app_domain, slug.localhost, or bare slug.';
comment on function public.custom_access_token_hook(jsonb) is
  'Supabase custom access token hook. Adds tenant_id and user_role claims from the active membership.';
comment on function public.current_tenant_id() is
  'Active tenant for auth.uid(). Honors a JWT tenant_id claim only when that user has an active membership there.';
-- Billflow migration 4 of 4
-- Row level security, explicit Data API grants, locked-down function EXECUTE.
--
-- This Supabase project was created with automatic Data API grants OFF.
-- Nothing here is exposed to anon / authenticated / service_role until the
-- GRANTs below. RLS still decides which rows a granted role can touch.
-- service_role bypasses RLS on Supabase (BYPASSRLS) but still needs GRANT.

-- ---------------------------------------------------------------------------
-- Balance view. security_invoker so the caller's RLS applies.
-- ---------------------------------------------------------------------------

create or replace view public.invoice_balances
with (security_invoker = true) as
select
  i.id as invoice_id,
  i.tenant_id,
  i.total,
  coalesce(sum(p.amount) filter (where p.status = 'succeeded'), 0)::numeric(12, 2) as amount_paid,
  (
    i.total - coalesce(sum(p.amount) filter (where p.status = 'succeeded'), 0)
  )::numeric(12, 2) as balance
from public.invoices i
left join public.payments p on p.invoice_id = i.id
group by i.id;

-- ---------------------------------------------------------------------------
-- Enable RLS on every public table
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'platform_settings', 'plans', 'tenants', 'users', 'memberships',
    'invitations', 'sites', 'subscriptions', 'customers', 'tax_rates',
    'invoice_counters', 'invoices', 'invoice_items', 'payments',
    'webhook_endpoints', 'webhook_deliveries', 'audit_logs'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Policies. Writes are role-gated. Reads are tenant-scoped.
-- current_tenant_id() / has_*() are SECURITY DEFINER, so these policies
-- do not recursively re-enter RLS.
-- ---------------------------------------------------------------------------

create policy platform_settings_select
  on public.platform_settings
  for select
  to anon, authenticated
  using (true);

create policy plans_select
  on public.plans
  for select
  to anon, authenticated
  using (is_public = true);

create policy tenants_select
  on public.tenants
  for select
  to authenticated
  using (public.is_member_of(id));

create policy tenants_update
  on public.tenants
  for update
  to authenticated
  using (id = public.current_tenant_id() and public.has_admin_access())
  with check (id = public.current_tenant_id() and public.has_admin_access());

create policy users_select
  on public.users
  for select
  to authenticated
  using (id = auth.uid() or public.shares_active_tenant(id));

create policy users_update_self
  on public.users
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy memberships_select
  on public.memberships
  for select
  to authenticated
  using (user_id = auth.uid() or tenant_id = public.current_tenant_id());

create policy memberships_insert
  on public.memberships
  for insert
  to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.has_admin_access()
    and (role <> 'owner' or public.current_user_role() = 'owner')
  );

create policy memberships_update
  on public.memberships
  for update
  to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_admin_access())
  with check (
    tenant_id = public.current_tenant_id()
    and public.has_admin_access()
    and (role <> 'owner' or public.current_user_role() = 'owner')
  );

create policy memberships_delete
  on public.memberships
  for delete
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.has_admin_access()
    and user_id <> auth.uid()
  );

create policy invitations_select
  on public.invitations
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

create policy invitations_write
  on public.invitations
  for all
  to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_admin_access())
  with check (tenant_id = public.current_tenant_id() and public.has_admin_access());

create policy sites_select
  on public.sites
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

create policy sites_update
  on public.sites
  for update
  to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_admin_access())
  with check (tenant_id = public.current_tenant_id() and public.has_admin_access());

create policy subscriptions_select
  on public.subscriptions
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

create policy subscriptions_write
  on public.subscriptions
  for all
  to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_admin_access())
  with check (tenant_id = public.current_tenant_id() and public.has_admin_access());

create policy customers_select
  on public.customers
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

create policy customers_write
  on public.customers
  for all
  to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_billing_access())
  with check (tenant_id = public.current_tenant_id() and public.has_billing_access());

create policy tax_rates_select
  on public.tax_rates
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

create policy tax_rates_write
  on public.tax_rates
  for all
  to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_billing_access())
  with check (tenant_id = public.current_tenant_id() and public.has_billing_access());

create policy invoice_counters_select
  on public.invoice_counters
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

-- Counter updates go through next_invoice_number() (security definer).
-- No insert/update/delete policy for authenticated.

create policy invoices_select
  on public.invoices
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

create policy invoices_insert
  on public.invoices
  for insert
  to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.has_billing_access()
  );

create policy invoices_update
  on public.invoices
  for update
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.has_billing_access()
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.has_billing_access()
  );

create policy invoices_delete
  on public.invoices
  for delete
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.has_billing_access()
    and status = 'draft'
  );

create policy invoice_items_select
  on public.invoice_items
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

create policy invoice_items_insert
  on public.invoice_items
  for insert
  to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.has_billing_access()
    and exists (
      select 1
      from public.invoices i
      where i.id = invoice_id
        and i.tenant_id = public.current_tenant_id()
        and i.status = 'draft'
    )
  );

create policy invoice_items_update
  on public.invoice_items
  for update
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.has_billing_access()
    and exists (
      select 1 from public.invoices i
      where i.id = invoice_id and i.status = 'draft'
    )
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.has_billing_access()
  );

create policy invoice_items_delete
  on public.invoice_items
  for delete
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.has_billing_access()
    and exists (
      select 1 from public.invoices i
      where i.id = invoice_id and i.status = 'draft'
    )
  );

create policy payments_select
  on public.payments
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

create policy payments_insert
  on public.payments
  for insert
  to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.has_billing_access()
  );

create policy payments_update
  on public.payments
  for update
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.has_billing_access()
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.has_billing_access()
  );

create policy webhooks_select
  on public.webhook_endpoints
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_admin_access());

create policy webhooks_write
  on public.webhook_endpoints
  for all
  to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_admin_access())
  with check (tenant_id = public.current_tenant_id() and public.has_admin_access());

create policy webhook_deliveries_select
  on public.webhook_deliveries
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_admin_access());

create policy webhook_deliveries_insert
  on public.webhook_deliveries
  for insert
  to authenticated
  with check (tenant_id = public.current_tenant_id() and public.has_admin_access());

create policy audit_logs_select
  on public.audit_logs
  for select
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('owner', 'admin', 'billing')
  );

-- No insert/update/delete policy on audit_logs. audit_row() is security definer.

-- ---------------------------------------------------------------------------
-- Grants
-- Automatic Data API grants are OFF on the target project. Be explicit.
-- anon: public catalog + published-site RPC only.
-- authenticated: DML on tenant tables; RLS filters rows and roles.
-- service_role: full DML. Used by cron / admin paths. Bypasses RLS on Supabase.
-- ---------------------------------------------------------------------------

grant usage on schema public to anon, authenticated, service_role;

grant select on public.plans to anon, authenticated;
grant select on public.platform_settings to anon, authenticated;

grant select, update on public.tenants to authenticated;
grant select, update (name) on public.users to authenticated;
grant select, insert, update, delete on public.memberships to authenticated;
grant select, insert, update, delete on public.invitations to authenticated;
grant select, update on public.sites to authenticated;
grant select, insert, update, delete on public.subscriptions to authenticated;
grant select, insert, update, delete on public.customers to authenticated;
grant select, insert, update, delete on public.tax_rates to authenticated;
grant select on public.invoice_counters to authenticated;
grant select, insert, update, delete on public.invoices to authenticated;
grant select, insert, update, delete on public.invoice_items to authenticated;
grant select, insert, update, delete on public.payments to authenticated;
grant select, insert, update, delete on public.webhook_endpoints to authenticated;
grant select, insert on public.webhook_deliveries to authenticated;
grant select on public.audit_logs to authenticated;
grant select on public.invoice_balances to authenticated, service_role;

grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated;

-- Future objects created by the migration role (postgres, in the SQL editor).
alter default privileges in schema public
  grant all on tables to service_role;
alter default privileges in schema public
  grant all on sequences to service_role;
alter default privileges in schema public
  grant all on functions to service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant usage, select on sequences to authenticated;

-- Do not grant future functions to anon/authenticated by default.
-- SECURITY DEFINER helpers must be opted in explicitly.
alter default privileges in schema public
  revoke execute on functions from public;

-- Lock every helper created above, then re-grant the minimum.
do $$
declare
  r record;
begin
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        'set_updated_at',
        'touch_invoice_counter_updated_at',
        'handle_new_user',
        'current_tenant_id',
        'current_user_role',
        'is_member_of',
        'shares_active_tenant',
        'has_billing_access',
        'has_admin_access',
        'sync_user_active_membership',
        'protect_last_owner',
        'next_invoice_number',
        'assign_invoice_defaults',
        'compute_item_amounts',
        'enforce_invoice_transition',
        'touch_invoice_totals',
        'guard_payment',
        'sync_invoice_payment_status',
        'audit_row',
        'create_tenant',
        'set_active_tenant',
        'get_site_by_host',
        'mark_overdue_invoices',
        'custom_access_token_hook'
      ])
  loop
    execute format(
      'revoke all on function public.%I(%s) from public, anon, authenticated',
      r.proname,
      r.args
    );
  end loop;
end $$;

grant execute on function public.current_tenant_id() to authenticated, service_role;
grant execute on function public.current_user_role() to authenticated, service_role;
grant execute on function public.is_member_of(uuid) to authenticated, service_role;
grant execute on function public.shares_active_tenant(uuid) to authenticated, service_role;
grant execute on function public.has_billing_access() to authenticated, service_role;
grant execute on function public.has_admin_access() to authenticated, service_role;
grant execute on function public.create_tenant(text, text) to authenticated, service_role;
grant execute on function public.set_active_tenant(uuid) to authenticated, service_role;
grant execute on function public.get_site_by_host(text) to anon, authenticated, service_role;
grant execute on function public.mark_overdue_invoices() to service_role;

-- Supabase Auth calls the hook as supabase_auth_admin. The role exists on
-- hosted projects and is created by the local test stub. Skip if it is absent
-- so a bare Postgres still accepts the migration.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema public to supabase_auth_admin;
    grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
    grant select on public.memberships to supabase_auth_admin;
    grant select on public.users to supabase_auth_admin;
  end if;
end $$;

revoke all on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
-- Billflow migration 5 of 4 (applied after RLS grants).
-- invite_member looks up users by email as security definer, so an admin
-- does not gain a way to list every profile through RLS.
-- Pending invitations are accepted when auth.users inserts a matching email.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.invitations;
begin
  insert into public.users (id, email, name)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'name',
      new.raw_user_meta_data ->> 'full_name',
      split_part(coalesce(new.email, 'user'), '@', 1)
    )
  )
  on conflict (id) do update
    set email = excluded.email,
        name = coalesce(public.users.name, excluded.name);

  if new.email is not null then
    for inv in
      select *
      from public.invitations i
      where lower(i.email) = lower(new.email)
        and i.status = 'pending'
        and i.expires_at > now()
    loop
      insert into public.memberships (tenant_id, user_id, role, status)
      values (inv.tenant_id, new.id, inv.role, 'active')
      on conflict (tenant_id, user_id) do update
        set role = excluded.role,
            status = 'active';
      update public.invitations
         set status = 'accepted'
       where id = inv.id;
    end loop;
  end if;

  return new;
end;
$$;

create or replace function public.invite_member(p_email text, p_role public.member_role)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  tid uuid := public.current_tenant_id();
  existing uuid;
  member_limit integer;
  member_count integer;
  m public.memberships;
  inv public.invitations;
  features jsonb;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if tid is null or not public.has_admin_access() then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('admin', 'billing', 'member') then
    raise exception 'role must be admin, billing, or member' using errcode = '22023';
  end if;
  if p_email is null or btrim(p_email) !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'a valid email is required' using errcode = '22023';
  end if;

  select pl.features into features
  from public.tenants t
  join public.plans pl on pl.code = t.plan
  where t.id = tid;

  if features is not null and features ? 'members' and jsonb_typeof(features -> 'members') = 'number' then
    member_limit := (features ->> 'members')::integer;
    select count(*) into member_count
    from public.memberships ms
    where ms.tenant_id = tid
      and ms.status = 'active';
    if member_count >= member_limit then
      raise exception 'plan member limit reached' using errcode = '23514';
    end if;
  end if;

  select u.id into existing
  from public.users u
  where lower(u.email) = lower(btrim(p_email));

  if existing is not null then
    if existing = uid and p_role::text is distinct from public.current_user_role() then
      raise exception 'cannot change your own role with invite_member' using errcode = '23514';
    end if;
    insert into public.memberships (tenant_id, user_id, role, status)
    values (tid, existing, p_role, 'active')
    on conflict (tenant_id, user_id) do update
      set role = excluded.role,
          status = 'active'
    returning * into m;
    return jsonb_build_object(
      'kind', 'membership',
      'membership_id', m.id,
      'user_id', m.user_id,
      'role', m.role,
      'status', m.status,
      'email', lower(btrim(p_email))
    );
  end if;

  insert into public.invitations (tenant_id, email, role, status, invited_by)
  values (tid, lower(btrim(p_email)), p_role, 'pending', uid)
  on conflict (tenant_id, lower(email)) where status = 'pending'
  do update set role = excluded.role, invited_by = excluded.invited_by, expires_at = now() + interval '14 days'
  returning * into inv;

  return jsonb_build_object(
    'kind', 'invitation',
    'invitation_id', inv.id,
    'email', inv.email,
    'role', inv.role,
    'status', inv.status,
    'expires_at', inv.expires_at
  );
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.invite_member(text, public.member_role) from public, anon, authenticated;
grant execute on function public.invite_member(text, public.member_role) to authenticated, service_role;

comment on function public.invite_member(text, public.member_role) is
  'Admin of the active tenant adds an existing user or records a pending invitation. Returns {kind: membership|invitation, ...}.';
-- Billflow migration 6
-- Public storefronts: subdomain, custom domains, templates.
-- Anonymous visitors cannot read these tables. They use get_site_by_host().

alter table public.tenants
  add column if not exists subdomain text;

alter table public.tenants
  drop constraint if exists tenants_subdomain_format;

alter table public.tenants
  add constraint tenants_subdomain_format check (
    subdomain is null
    or (
      subdomain ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
      and subdomain <> all (array[
        'www', 'app', 'api', 'admin', 'dashboard', 'mail', 'billing', 'static',
        'auth', 'sites', 'status', 'cdn', 'ftp', 'smtp', 'imap', 'pop',
        'ns1', 'ns2', 'support', 'help', 'blog', 'root'
      ])
    )
  );

create unique index if not exists tenants_subdomain_unique
  on public.tenants (subdomain)
  where subdomain is not null;

update public.tenants
   set subdomain = slug
 where subdomain is null
   and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
   and slug <> all (array[
     'www', 'app', 'api', 'admin', 'dashboard', 'mail', 'billing', 'static',
     'auth', 'sites', 'status', 'cdn', 'ftp', 'smtp', 'imap', 'pop',
     'ns1', 'ns2', 'support', 'help', 'blog', 'root'
   ]);

update public.platform_settings
   set app_domain = 'billflow.com',
       dashboard_host = 'app.billflow.com'
 where id = 1;

-- ---------------------------------------------------------------------------
-- Catalog and per-tenant settings
-- ---------------------------------------------------------------------------

create table if not exists public.templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text not null default '',
  config jsonb not null default '{}'::jsonb,
  preview_image_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint templates_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

insert into public.templates (id, name, slug, description, preview_image_url, config) values
  (
    '71000000-0000-4000-8000-000000000001',
    'Classic',
    'classic',
    'A centered shopfront with a cream page and a clear list of services.',
    '/templates/classic.svg',
    jsonb_build_object(
      'colors', jsonb_build_object('background', '#faf7f2', 'text', '#1c1917', 'accent', '#0f766e', 'muted', '#78716c'),
      'fonts', jsonb_build_object('heading', 'Georgia', 'body', 'Outfit'),
      'layout', jsonb_build_object('hero', 'center', 'nav', 'top'),
      'sections', jsonb_build_array(
        jsonb_build_object('id', 'hero', 'enabled', true, 'title', 'Welcome', 'body', 'Tell customers what you do.'),
        jsonb_build_object('id', 'services', 'enabled', true, 'title', 'Services', 'body', 'What you can hire us for.'),
        jsonb_build_object('id', 'contact', 'enabled', true, 'title', 'Contact', 'body', 'How to reach the shop.')
      )
    )
  ),
  (
    '71000000-0000-4000-8000-000000000002',
    'Modern',
    'modern',
    'Split hero, navy type, and an emerald accent. Built for a studio or agency.',
    '/templates/modern.svg',
    jsonb_build_object(
      'colors', jsonb_build_object('background', '#f8fafc', 'text', '#0f172a', 'accent', '#10b981', 'muted', '#64748b'),
      'fonts', jsonb_build_object('heading', 'Outfit', 'body', 'Outfit'),
      'layout', jsonb_build_object('hero', 'split', 'nav', 'top'),
      'sections', jsonb_build_array(
        jsonb_build_object('id', 'hero', 'enabled', true, 'title', 'Work with us', 'body', 'A short line about the business.'),
        jsonb_build_object('id', 'services', 'enabled', true, 'title', 'What we offer', 'body', 'Three things clients book most.'),
        jsonb_build_object('id', 'contact', 'enabled', true, 'title', 'Start a project', 'body', 'Email or pay by UPI.')
      )
    )
  ),
  (
    '71000000-0000-4000-8000-000000000003',
    'Minimal',
    'minimal',
    'Mostly type, lots of space, one accent color.',
    '/templates/minimal.svg',
    jsonb_build_object(
      'colors', jsonb_build_object('background', '#ffffff', 'text', '#111111', 'accent', '#14b8a6', 'muted', '#6b7280'),
      'fonts', jsonb_build_object('heading', 'Outfit', 'body', 'Outfit'),
      'layout', jsonb_build_object('hero', 'center', 'nav', 'top'),
      'sections', jsonb_build_array(
        jsonb_build_object('id', 'hero', 'enabled', true, 'title', 'Hello', 'body', 'One sentence is enough.'),
        jsonb_build_object('id', 'services', 'enabled', false, 'title', 'Services', 'body', ''),
        jsonb_build_object('id', 'contact', 'enabled', true, 'title', 'Write to us', 'body', '')
      )
    )
  )
on conflict (slug) do update
  set name = excluded.name,
      description = excluded.description,
      preview_image_url = excluded.preview_image_url,
      config = excluded.config,
      is_active = true;

create table if not exists public.tenant_template_settings (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  template_id uuid not null references public.templates (id),
  overrides jsonb not null default '{}'::jsonb,
  published_overrides jsonb,
  published_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.tenant_domains (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  domain text not null,
  verified boolean not null default false,
  verification_token text not null,
  ssl_status text not null default 'pending' check (ssl_status in ('pending', 'issuing', 'active', 'failed')),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_domains_format check (domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$')
);

create unique index if not exists tenant_domains_domain_unique
  on public.tenant_domains (lower(domain));

create unique index if not exists tenant_domains_one_primary
  on public.tenant_domains (tenant_id)
  where is_primary;

drop trigger if exists templates_set_updated_at on public.templates;
create trigger templates_set_updated_at
  before update on public.templates
  for each row execute function public.set_updated_at();

drop trigger if exists tenant_template_settings_set_updated_at on public.tenant_template_settings;
create trigger tenant_template_settings_set_updated_at
  before update on public.tenant_template_settings
  for each row execute function public.set_updated_at();

drop trigger if exists tenant_domains_set_updated_at on public.tenant_domains;
create trigger tenant_domains_set_updated_at
  before update on public.tenant_domains
  for each row execute function public.set_updated_at();

create or replace function public.assign_default_storefront()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  classic uuid;
begin
  if new.subdomain is null then
    new.subdomain := new.slug;
  end if;

  select id into classic from public.templates where slug = 'classic';
  if classic is not null then
    insert into public.tenant_template_settings (tenant_id, template_id)
    values (new.id, classic)
    on conflict (tenant_id) do nothing;
  end if;
  return new;
end;
$$;

-- subdomain default must run BEFORE insert so the row satisfies the check.
drop trigger if exists tenants_assign_storefront on public.tenants;
create trigger tenants_assign_storefront
  before insert on public.tenants
  for each row execute function public.assign_default_storefront();

-- The settings insert inside a BEFORE trigger cannot see new.id as a committed
-- row. Do the settings insert AFTER insert instead.
create or replace function public.assign_default_storefront()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.subdomain is null then
    new.subdomain := new.slug;
  end if;
  return new;
end;
$$;

create or replace function public.seed_default_storefront()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  classic uuid;
begin
  select id into classic from public.templates where slug = 'classic';
  if classic is not null then
    insert into public.tenant_template_settings (tenant_id, template_id)
    values (new.id, classic)
    on conflict (tenant_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists tenants_seed_storefront on public.tenants;
create trigger tenants_seed_storefront
  after insert on public.tenants
  for each row execute function public.seed_default_storefront();

-- ---------------------------------------------------------------------------
-- Public lookup. Published storefronts only. No tokens, no drafts.
-- ---------------------------------------------------------------------------

create or replace function public.get_site_by_host(p_host text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  h text := lower(rtrim(split_part(coalesce(p_host, ''), ':', 1), '.'));
  app_domain text;
  tid uuid;
  sub text;
  tname text;
  logo text;
  currency text;
  slug text;
  tmpl_slug text;
  tmpl_name text;
  base_config jsonb;
  published jsonb;
  published_at timestamptz;
  colors jsonb;
  fonts jsonb;
  layout jsonb;
  sections jsonb;
begin
  if h = '' then
    return null;
  end if;

  select s.app_domain into app_domain from public.platform_settings s where s.id = 1;
  app_domain := lower(coalesce(app_domain, 'billflow.com'));

  select t.id, coalesce(t.subdomain, t.slug), t.slug, t.name, t.logo_url, t.currency
    into tid, sub, slug, tname, logo, currency
  from public.tenants t
  left join public.tenant_domains d
    on d.tenant_id = t.id
   and d.verified
   and lower(d.domain) = h
  left join public.sites site
    on site.tenant_id = t.id
   and lower(site.custom_domain) = h
  where d.id is not null
     or site.id is not null
     or lower(coalesce(t.subdomain, t.slug)) = h
     or lower(coalesce(t.subdomain, t.slug)) || '.' || app_domain = h
     or lower(coalesce(t.subdomain, t.slug)) || '.localhost' = h
  order by case when d.id is not null or site.id is not null then 0 else 1 end
  limit 1;

  if tid is null then
    return null;
  end if;

  select ts.published_overrides, ts.published_at, tmpl.config, tmpl.slug, tmpl.name
    into published, published_at, base_config, tmpl_slug, tmpl_name
  from public.tenant_template_settings ts
  join public.templates tmpl on tmpl.id = ts.template_id
  where ts.tenant_id = tid
    and ts.published_at is not null;

  if published_at is null then
    -- Legacy published flag, still without private columns.
    if not exists (
      select 1 from public.sites site
      where site.tenant_id = tid and site.published
    ) then
      return null;
    end if;
    return (
      select jsonb_build_object(
        'tenant_id', tid,
        'slug', slug,
        'subdomain', sub,
        'name', tname,
        'title', site.title,
        'tagline', site.tagline,
        'about', site.about,
        'logo_url', coalesce(tname.logo, logo),
        'published', true,
        'host', h,
        'currency', currency,
        'template', jsonb_build_object('slug', 'classic', 'name', 'Classic'),
        'config', coalesce(site.theme, '{}'::jsonb)
      )
      from public.sites site
      left join public.tenants tname on false
      where site.tenant_id = tid
    );
  end if;

  published := coalesce(published, '{}'::jsonb);
  base_config := coalesce(base_config, '{}'::jsonb);
  colors := coalesce(base_config -> 'colors', '{}'::jsonb) || coalesce(published -> 'colors', '{}'::jsonb);
  fonts := coalesce(base_config -> 'fonts', '{}'::jsonb) || coalesce(published -> 'fonts', '{}'::jsonb);
  layout := coalesce(base_config -> 'layout', '{}'::jsonb) || coalesce(published -> 'layout', '{}'::jsonb);
  sections := case
    when jsonb_typeof(published -> 'sections') = 'array' then published -> 'sections'
    else coalesce(base_config -> 'sections', '[]'::jsonb)
  end;

  return jsonb_build_object(
    'tenant_id', tid,
    'slug', slug,
    'subdomain', sub,
    'name', tname,
    'title', coalesce(published ->> 'title', tname),
    'tagline', published ->> 'tagline',
    'about', published ->> 'about',
    'logo_url', coalesce(published ->> 'logo_url', logo),
    'published', true,
    'host', h,
    'currency', currency,
    'template', jsonb_build_object('slug', tmpl_slug, 'name', tmpl_name),
    'config', jsonb_build_object(
      'colors', colors,
      'fonts', fonts,
      'layout', layout,
      'sections', sections
    )
  );
end;
$$;

-- The legacy branch above references a bogus join. Replace with a clean function.
create or replace function public.get_site_by_host(p_host text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  h text := lower(rtrim(split_part(coalesce(p_host, ''), ':', 1), '.'));
  app_domain text;
  tid uuid;
  sub text;
  tname text;
  logo text;
  currency text;
  slug text;
  tmpl_slug text;
  tmpl_name text;
  base_config jsonb;
  published jsonb;
  published_at timestamptz;
  legacy_title text;
  legacy_tagline text;
  legacy_about text;
  legacy_published boolean;
begin
  if h = '' then
    return null;
  end if;

  select s.app_domain into app_domain from public.platform_settings s where s.id = 1;
  app_domain := lower(coalesce(app_domain, 'billflow.com'));

  select t.id, coalesce(t.subdomain, t.slug), t.slug, t.name, t.logo_url, t.currency
    into tid, sub, slug, tname, logo, currency
  from public.tenants t
  left join public.tenant_domains d
    on d.tenant_id = t.id and d.verified and lower(d.domain) = h
  left join public.sites site
    on site.tenant_id = t.id and lower(site.custom_domain) = h
  where d.id is not null
     or site.id is not null
     or lower(coalesce(t.subdomain, t.slug)) = h
     or lower(coalesce(t.subdomain, t.slug)) || '.' || app_domain = h
     or lower(coalesce(t.subdomain, t.slug)) || '.localhost' = h
  order by case when d.id is not null or site.id is not null then 0 else 1 end
  limit 1;

  if tid is null then
    return null;
  end if;

  select ts.published_overrides, ts.published_at, tmpl.config, tmpl.slug, tmpl.name
    into published, published_at, base_config, tmpl_slug, tmpl_name
  from public.tenant_template_settings ts
  join public.templates tmpl on tmpl.id = ts.template_id
  where ts.tenant_id = tid
    and ts.published_at is not null;

  if published_at is not null then
    published := coalesce(published, '{}'::jsonb);
    base_config := coalesce(base_config, '{}'::jsonb);
    return jsonb_build_object(
      'tenant_id', tid,
      'slug', slug,
      'subdomain', sub,
      'name', tname,
      'title', coalesce(published ->> 'title', tname),
      'tagline', published ->> 'tagline',
      'about', published ->> 'about',
      'logo_url', coalesce(published ->> 'logo_url', logo),
      'published', true,
      'host', h,
      'currency', currency,
      'template', jsonb_build_object('slug', tmpl_slug, 'name', tmpl_name),
      'config', jsonb_build_object(
        'colors', coalesce(base_config -> 'colors', '{}'::jsonb) || coalesce(published -> 'colors', '{}'::jsonb),
        'fonts', coalesce(base_config -> 'fonts', '{}'::jsonb) || coalesce(published -> 'fonts', '{}'::jsonb),
        'layout', coalesce(base_config -> 'layout', '{}'::jsonb) || coalesce(published -> 'layout', '{}'::jsonb),
        'sections', case
          when jsonb_typeof(published -> 'sections') = 'array' then published -> 'sections'
          else coalesce(base_config -> 'sections', '[]'::jsonb)
        end
      )
    );
  end if;

  select site.title, site.tagline, site.about, site.published
    into legacy_title, legacy_tagline, legacy_about, legacy_published
  from public.sites site
  where site.tenant_id = tid;

  if coalesce(legacy_published, false) = false then
    return null;
  end if;

  return jsonb_build_object(
    'tenant_id', tid,
    'slug', slug,
    'subdomain', sub,
    'name', tname,
    'title', coalesce(legacy_title, tname),
    'tagline', legacy_tagline,
    'about', legacy_about,
    'logo_url', logo,
    'published', true,
    'host', h,
    'currency', currency,
    'template', jsonb_build_object('slug', 'classic', 'name', 'Classic'),
    'config', '{}'::jsonb
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS. Anon has no table privileges here.
-- ---------------------------------------------------------------------------

alter table public.templates enable row level security;
alter table public.tenant_template_settings enable row level security;
alter table public.tenant_domains enable row level security;

drop policy if exists templates_select on public.templates;
create policy templates_select
  on public.templates
  for select
  to authenticated
  using (is_active);

drop policy if exists storefront_select on public.tenant_template_settings;
create policy storefront_select
  on public.tenant_template_settings
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists storefront_write on public.tenant_template_settings;
create policy storefront_write
  on public.tenant_template_settings
  for all
  to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_admin_access())
  with check (tenant_id = public.current_tenant_id() and public.has_admin_access());

drop policy if exists domains_all on public.tenant_domains;
create policy domains_all
  on public.tenant_domains
  for all
  to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_admin_access())
  with check (tenant_id = public.current_tenant_id() and public.has_admin_access());

grant select on public.templates to authenticated;
grant select, insert, update, delete on public.tenant_template_settings to authenticated;
grant select, insert, update, delete on public.tenant_domains to authenticated;
grant all privileges on public.templates, public.tenant_template_settings, public.tenant_domains to service_role;

revoke all on function public.get_site_by_host(text) from public, anon, authenticated;
grant execute on function public.get_site_by_host(text) to anon, authenticated, service_role;
revoke all on function public.assign_default_storefront() from public, anon, authenticated;
revoke all on function public.seed_default_storefront() from public, anon, authenticated;

-- Storage bucket. Present on hosted Supabase, absent in the local stub.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
    values ('tenant-assets', 'tenant-assets', true)
    on conflict (id) do nothing;

    execute 'drop policy if exists tenant_assets_public_read on storage.objects';
    execute 'drop policy if exists tenant_assets_insert on storage.objects';
    execute 'drop policy if exists tenant_assets_update on storage.objects';
    execute 'drop policy if exists tenant_assets_delete on storage.objects';

    execute $pol$
      create policy tenant_assets_public_read on storage.objects
        for select to anon, authenticated
        using (bucket_id = 'tenant-assets')
    $pol$;
    execute $pol$
      create policy tenant_assets_insert on storage.objects
        for insert to authenticated
        with check (
          bucket_id = 'tenant-assets'
          and (storage.foldername(name))[1] = public.current_tenant_id()::text
          and public.has_admin_access()
        )
    $pol$;
    execute $pol$
      create policy tenant_assets_update on storage.objects
        for update to authenticated
        using (
          bucket_id = 'tenant-assets'
          and (storage.foldername(name))[1] = public.current_tenant_id()::text
          and public.has_admin_access()
        )
    $pol$;
    execute $pol$
      create policy tenant_assets_delete on storage.objects
        for delete to authenticated
        using (
          bucket_id = 'tenant-assets'
          and (storage.foldername(name))[1] = public.current_tenant_id()::text
          and public.has_admin_access()
        )
    $pol$;
  end if;
end $$;

comment on table public.tenant_domains is
  'Custom domains. verification_token is shown only to tenant admins. Anon uses get_site_by_host.';
comment on function public.get_site_by_host(text) is
  'Published public storefront for a host. Subdomain, localhost, or a verified custom domain. No drafts and no tokens.';
-- WhatsApp sharing, GST document fields, reminders, and POS.
-- New tables are tenant-scoped. Anon cannot read them. Public invoice
-- views go through get_shared_invoice(token).

alter table public.customers
  add column if not exists billing_state_code text,
  add column if not exists reminder_opt_out boolean not null default false;

alter table public.invoice_items
  add column if not exists unit text not null default 'NOS',
  add column if not exists discount numeric(12, 2) not null default 0 check (discount >= 0);

alter table public.invoices
  add column if not exists document_type text not null default 'tax_invoice'
    check (document_type in ('tax_invoice', 'bill_of_supply', 'credit_note', 'debit_note')),
  add column if not exists financial_year text,
  add column if not exists amount_in_words text,
  add column if not exists cgst_total numeric(12, 2) not null default 0,
  add column if not exists sgst_total numeric(12, 2) not null default 0,
  add column if not exists igst_total numeric(12, 2) not null default 0,
  add column if not exists source text not null default 'billing' check (source in ('billing', 'pos')),
  add column if not exists reference_invoice_id uuid references public.invoices (id),
  add column if not exists irn text,
  add column if not exists ack_no text,
  add column if not exists ack_date timestamptz,
  add column if not exists signed_qr text,
  add column if not exists einvoice_status text not null default 'not_generated'
    check (einvoice_status in ('not_generated', 'pending', 'generated', 'cancelled', 'failed'));

alter table public.invoices drop constraint if exists invoices_number_max;
alter table public.invoices
  add constraint invoices_number_max check (char_length(number) <= 16);

alter table public.payments
  add column if not exists tendered numeric(12, 2),
  add column if not exists change_amount numeric(12, 2);

-- Line discount is part of the taxable value. Existing rows have discount 0.
create or replace function public.compute_item_amounts()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  tid uuid;
  supply public.supply_type;
  rate numeric(6, 3);
  taxable numeric(12, 2);
begin
  select i.tenant_id, i.supply_type into tid, supply
  from public.invoices i where i.id = new.invoice_id;
  if tid is null then
    raise exception 'invoice not found' using errcode = '23503';
  end if;
  new.tenant_id := tid;
  if new.tax_rate_id is not null then
    select tr.rate into rate from public.tax_rates tr
    where tr.id = new.tax_rate_id and tr.tenant_id = tid;
    if rate is null then
      raise exception 'tax rate not found for this tenant' using errcode = '23503';
    end if;
    new.tax_rate := rate;
  end if;
  taxable := round(new.quantity * new.unit_price - coalesce(new.discount, 0), 2);
  if taxable < 0 then
    raise exception 'line discount exceeds the line value' using errcode = '23514';
  end if;
  new.line_subtotal := taxable;
  new.tax_amount := round(taxable * coalesce(new.tax_rate, 0) / 100.0, 2);
  if supply = 'inter' then
    new.igst_amount := new.tax_amount;
    new.cgst_amount := 0;
    new.sgst_amount := 0;
  else
    new.cgst_amount := round(new.tax_amount / 2, 2);
    new.sgst_amount := new.tax_amount - new.cgst_amount;
    new.igst_amount := 0;
  end if;
  new.line_total := new.line_subtotal + new.tax_amount;
  return new;
end;
$$;

-- Recompute invoice tax split alongside the existing total trigger.
create or replace function public.stamp_invoice_gst()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  cgst numeric(12, 2);
  sgst numeric(12, 2);
  igst numeric(12, 2);
begin
  select coalesce(sum(cgst_amount), 0), coalesce(sum(sgst_amount), 0), coalesce(sum(igst_amount), 0)
    into cgst, sgst, igst
  from public.invoice_items where invoice_id = new.id;
  new.cgst_total := cgst;
  new.sgst_total := sgst;
  new.igst_total := igst;
  if new.financial_year is null then
    if extract(month from coalesce(new.issued_at, new.created_at, now())) >= 4 then
      new.financial_year := to_char(coalesce(new.issued_at, now()), 'YY') || to_char(coalesce(new.issued_at, now()) + interval '1 year', 'YY');
    else
      new.financial_year := to_char(coalesce(new.issued_at, now()) - interval '1 year', 'YY') || to_char(coalesce(new.issued_at, now()), 'YY');
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists invoices_stamp_gst on public.invoices;
create trigger invoices_stamp_gst
  before insert or update on public.invoices
  for each row execute function public.stamp_invoice_gst();

-- Financial-year gapless numbers, max 16 characters.
create table if not exists public.invoice_fy_counters (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  financial_year text not null,
  next_number integer not null default 1 check (next_number > 0),
  primary key (tenant_id, financial_year)
);

create or replace function public.next_invoice_number(p_tenant uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  prefix text;
  fy text;
  n integer;
  width integer;
  number text;
  now_ist timestamp := (now() at time zone 'Asia/Kolkata');
begin
  if extract(month from now_ist) >= 4 then
    fy := to_char(now_ist, 'YY') || to_char(now_ist + interval '1 year', 'YY');
  else
    fy := to_char(now_ist - interval '1 year', 'YY') || to_char(now_ist, 'YY');
  end if;

  select left(regexp_replace(coalesce(t.invoice_prefix, 'INV'), '[^A-Za-z0-9]', '', 'g'), 6)
    into prefix
  from public.tenants t where t.id = p_tenant;
  prefix := coalesce(nullif(prefix, ''), 'INV');

  insert into public.invoice_fy_counters (tenant_id, financial_year)
  values (p_tenant, fy)
  on conflict (tenant_id, financial_year) do nothing;

  update public.invoice_fy_counters
     set next_number = next_number + 1
   where tenant_id = p_tenant and financial_year = fy
  returning next_number - 1 into n;

  width := greatest(3, 16 - char_length(prefix) - char_length(fy));
  number := prefix || fy || lpad(n::text, width, '0');
  if char_length(number) > 16 then
    raise exception 'invoice number exceeds 16 characters' using errcode = '23514';
  end if;
  return number;
end;
$$;

-- ---------------------------------------------------------------------------
-- Sharing, messaging, reminders, catalog
-- ---------------------------------------------------------------------------

create table if not exists public.invoice_shares (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  token text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint invoice_shares_token_len check (char_length(token) >= 24)
);

create index if not exists invoice_shares_invoice_idx on public.invoice_shares (invoice_id);

create table if not exists public.whatsapp_settings (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  phone_number_id text,
  waba_id text,
  enabled boolean not null default false,
  access_token text,
  updated_at timestamptz not null default now()
);

create table if not exists public.messaging_settings (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  sms_provider text not null default 'none' check (sms_provider in ('none', 'msg91', 'twilio')),
  email_provider text not null default 'none' check (email_provider in ('none', 'smtp', 'resend')),
  msg91_sender_id text,
  msg91_dlt_template_id text,
  twilio_from text,
  smtp_host text,
  smtp_port integer,
  smtp_user text,
  resend_from text,
  secrets jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.message_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  invoice_id uuid references public.invoices (id) on delete set null,
  customer_id uuid references public.customers (id) on delete set null,
  channel text not null check (channel in ('whatsapp', 'sms', 'email')),
  status text not null check (status in ('queued', 'sent', 'delivered', 'read', 'failed', 'skipped')),
  provider text,
  provider_id text,
  error text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists message_logs_tenant_idx on public.message_logs (tenant_id, created_at desc);
create index if not exists message_logs_provider_idx on public.message_logs (provider_id) where provider_id is not null;

create table if not exists public.reminder_schedules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  offset_days integer not null,
  channel text not null check (channel in ('email', 'sms', 'whatsapp')),
  template text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, offset_days, channel)
);

create table if not exists public.reminder_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  schedule_id uuid references public.reminder_schedules (id) on delete set null,
  channel text not null,
  idempotency_key text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  provider_id text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, idempotency_key)
);

create index if not exists reminder_jobs_due_idx
  on public.reminder_jobs (status, next_attempt_at)
  where status = 'pending';

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  sku text,
  barcode text,
  hsn_sac text,
  unit text not null default 'NOS',
  price numeric(12, 2) not null check (price >= 0),
  gst_rate numeric(6, 3) not null default 0 check (gst_rate >= 0 and gst_rate <= 100),
  stock numeric(12, 3),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists products_tenant_idx on public.products (tenant_id, name);
create index if not exists products_barcode_idx on public.products (tenant_id, barcode);

create table if not exists public.pos_settings (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  default_tax_rate numeric(6, 3) not null default 18,
  receipt_footer text not null default 'Thank you.',
  paper_width integer not null default 80 check (paper_width in (58, 80)),
  updated_at timestamptz not null default now()
);

-- Public invoice view. Token is unguessable. Expired or revoked links return null.
create or replace function public.get_shared_invoice(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  share public.invoice_shares;
  inv public.invoices;
  seller public.tenants;
  buyer public.customers;
  lines jsonb;
begin
  select * into share from public.invoice_shares s
  where s.token = p_token and s.revoked_at is null and s.expires_at > now();
  if not found then
    return null;
  end if;
  select * into inv from public.invoices where id = share.invoice_id;
  select * into seller from public.tenants where id = inv.tenant_id;
  select * into buyer from public.customers where id = inv.customer_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'description', it.description,
    'hsn_sac', it.hsn_sac,
    'quantity', it.quantity,
    'unit', it.unit,
    'unit_price', it.unit_price,
    'discount', it.discount,
    'tax_rate', it.tax_rate,
    'cgst_amount', it.cgst_amount,
    'sgst_amount', it.sgst_amount,
    'igst_amount', it.igst_amount,
    'line_total', it.line_total
  ) order by it.sort_order), '[]'::jsonb)
    into lines
  from public.invoice_items it where it.invoice_id = inv.id;

  return jsonb_build_object(
    'number', inv.number,
    'document_type', inv.document_type,
    'status', inv.status,
    'supply_type', inv.supply_type,
    'place_of_supply', inv.place_of_supply,
    'currency', inv.currency,
    'issued_at', inv.issued_at,
    'due_at', inv.due_at,
    'amount', inv.amount,
    'tax', inv.tax,
    'discount', inv.discount,
    'cgst_total', inv.cgst_total,
    'sgst_total', inv.sgst_total,
    'igst_total', inv.igst_total,
    'total', inv.total,
    'amount_in_words', inv.amount_in_words,
    'irn', inv.irn,
    'ack_no', inv.ack_no,
    'seller', jsonb_build_object(
      'name', coalesce(seller.legal_name, seller.name),
      'gstin', seller.gstin,
      'state_code', seller.state_code,
      'address', seller.address_line1,
      'upi_vpa', seller.upi_vpa
    ),
    'buyer', jsonb_build_object(
      'name', buyer.name,
      'gstin', buyer.gstin,
      'state_code', buyer.billing_state_code
    ),
    'items', lines
  );
end;
$$;

create or replace function public.enqueue_due_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  insert into public.reminder_jobs (
    tenant_id, invoice_id, schedule_id, channel, idempotency_key, status, next_attempt_at
  )
  select
    i.tenant_id,
    i.id,
    s.id,
    s.channel,
    i.id::text || ':' || s.id::text || ':' || ((i.due_at at time zone 'Asia/Kolkata')::date + s.offset_days)::text,
    'pending',
    now()
  from public.invoices i
  join public.reminder_schedules s on s.tenant_id = i.tenant_id and s.enabled
  join public.customers c on c.id = i.customer_id
  where i.status in ('sent', 'overdue')
    and i.due_at is not null
    and coalesce(c.reminder_opt_out, false) = false
    and ((i.due_at at time zone 'Asia/Kolkata')::date + s.offset_days) <= (now() at time zone 'Asia/Kolkata')::date
    and ((i.due_at at time zone 'Asia/Kolkata')::date + s.offset_days) >= (now() at time zone 'Asia/Kolkata')::date - 3
  on conflict (tenant_id, idempotency_key) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.gstr1_summary(p_from date, p_to date)
returns table (
  hsn_sac text,
  tax_rate numeric,
  taxable_value numeric,
  cgst numeric,
  sgst numeric,
  igst numeric,
  total_tax numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    coalesce(it.hsn_sac, ''),
    it.tax_rate,
    sum(it.line_subtotal),
    sum(it.cgst_amount),
    sum(it.sgst_amount),
    sum(it.igst_amount),
    sum(it.tax_amount)
  from public.invoice_items it
  join public.invoices i on i.id = it.invoice_id
  where i.status <> 'void'
    and coalesce(i.issued_at, i.created_at)::date between p_from and p_to
  group by 1, 2
  order by 1, 2;
$$;

create or replace function public.pos_checkout(
  p_customer_id uuid,
  p_lines jsonb,
  p_method public.payment_method,
  p_supply public.supply_type,
  p_place text,
  p_tendered numeric
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  tid uuid := public.current_tenant_id();
  inv public.invoices;
  line jsonb;
  idx integer := 0;
begin
  if uid is null or tid is null or not public.has_billing_access() then
    raise exception 'billing access required' using errcode = '42501';
  end if;
  if p_customer_id is null or jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) < 1 then
    raise exception 'customer and at least one line are required' using errcode = '22023';
  end if;

  insert into public.invoices (
    tenant_id, customer_id, supply_type, place_of_supply, source, document_type, status
  ) values (
    tid, p_customer_id, p_supply, p_place, 'pos',
    case when exists (
      select 1 from jsonb_array_elements(p_lines) e where coalesce((e ->> 'gst_rate')::numeric, 0) > 0
    ) then 'tax_invoice' else 'bill_of_supply' end,
    'draft'
  ) returning * into inv;

  for line in select * from jsonb_array_elements(p_lines)
  loop
    idx := idx + 1;
    insert into public.invoice_items (
      tenant_id, invoice_id, description, quantity, unit_price, discount, tax_rate, hsn_sac, unit, sort_order
    ) values (
      tid,
      inv.id,
      line ->> 'description',
      (line ->> 'quantity')::numeric,
      (line ->> 'unit_price')::numeric,
      coalesce((line ->> 'discount')::numeric, 0),
      coalesce((line ->> 'gst_rate')::numeric, 0),
      line ->> 'hsn_sac',
      coalesce(line ->> 'unit', 'NOS'),
      idx
    );
    if (line ->> 'product_id') is not null and (line ->> 'quantity') is not null then
      update public.products
         set stock = stock - (line ->> 'quantity')::numeric
       where id = (line ->> 'product_id')::uuid
         and tenant_id = tid
         and stock is not null;
    end if;
  end loop;

  select * into inv from public.invoices where id = inv.id;

  insert into public.payments (
    tenant_id, invoice_id, amount, method, status, tendered, change_amount, paid_at
  ) values (
    tid,
    inv.id,
    inv.total,
    p_method,
    'succeeded',
    p_tendered,
    case when p_method = 'cash' and p_tendered is not null then greatest(p_tendered - inv.total, 0) else null end,
    now()
  );

  select * into inv from public.invoices where id = inv.id;
  return jsonb_build_object('invoice_id', inv.id, 'number', inv.number, 'total', inv.total, 'status', inv.status);
end;
$$;

-- RLS
do $$
declare t text;
begin
  foreach t in array array[
    'invoice_shares', 'whatsapp_settings', 'messaging_settings', 'message_logs',
    'reminder_schedules', 'reminder_jobs', 'products', 'pos_settings', 'invoice_fy_counters'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

create policy invoice_shares_select on public.invoice_shares for select to authenticated
  using (tenant_id = public.current_tenant_id());
create policy invoice_shares_write on public.invoice_shares for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_billing_access())
  with check (tenant_id = public.current_tenant_id() and public.has_billing_access());

create policy whatsapp_settings_all on public.whatsapp_settings for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_admin_access())
  with check (tenant_id = public.current_tenant_id() and public.has_admin_access());

create policy messaging_settings_all on public.messaging_settings for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_admin_access())
  with check (tenant_id = public.current_tenant_id() and public.has_admin_access());

create policy message_logs_select on public.message_logs for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_billing_access());
create policy message_logs_insert on public.message_logs for insert to authenticated
  with check (tenant_id = public.current_tenant_id() and public.has_billing_access());

create policy reminder_schedules_all on public.reminder_schedules for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_admin_access())
  with check (tenant_id = public.current_tenant_id() and public.has_admin_access());
create policy reminder_schedules_read on public.reminder_schedules for select to authenticated
  using (tenant_id = public.current_tenant_id());

create policy reminder_jobs_select on public.reminder_jobs for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_billing_access());

create policy products_select on public.products for select to authenticated
  using (tenant_id = public.current_tenant_id());
create policy products_write on public.products for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_billing_access())
  with check (tenant_id = public.current_tenant_id() and public.has_billing_access());

create policy pos_settings_all on public.pos_settings for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_admin_access())
  with check (tenant_id = public.current_tenant_id() and public.has_admin_access());
create policy pos_settings_read on public.pos_settings for select to authenticated
  using (tenant_id = public.current_tenant_id());

create policy fy_counters_select on public.invoice_fy_counters for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_billing_access());

grant select, insert, update, delete on public.invoice_shares to authenticated;
grant select, insert, update, delete on public.whatsapp_settings to authenticated;
grant select, insert, update, delete on public.messaging_settings to authenticated;
grant select, insert on public.message_logs to authenticated;
grant select, insert, update, delete on public.reminder_schedules to authenticated;
grant select on public.reminder_jobs to authenticated;
grant select, insert, update, delete on public.products to authenticated;
grant select, insert, update, delete on public.pos_settings to authenticated;
grant select on public.invoice_fy_counters to authenticated;
grant all privileges on public.invoice_shares, public.whatsapp_settings, public.messaging_settings,
  public.message_logs, public.reminder_schedules, public.reminder_jobs, public.products,
  public.pos_settings, public.invoice_fy_counters to service_role;

revoke select (access_token) on public.whatsapp_settings from authenticated, anon;
revoke select (secrets) on public.messaging_settings from authenticated, anon;

revoke all on function public.get_shared_invoice(text) from public;
grant execute on function public.get_shared_invoice(text) to anon, authenticated, service_role;
revoke all on function public.enqueue_due_reminders() from public, anon, authenticated;
grant execute on function public.enqueue_due_reminders() to service_role;
grant execute on function public.gstr1_summary(date, date) to authenticated, service_role;
grant execute on function public.pos_checkout(uuid, jsonb, public.payment_method, public.supply_type, text, numeric)
  to authenticated, service_role;
revoke all on function public.next_invoice_number(uuid) from public, anon;
grant execute on function public.next_invoice_number(uuid) to authenticated, service_role;

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
    values ('invoice-pdfs', 'invoice-pdfs', false)
    on conflict (id) do nothing;
    execute 'drop policy if exists invoice_pdfs_read on storage.objects';
    execute $p$
      create policy invoice_pdfs_read on storage.objects
        for select to authenticated
        using (
          bucket_id = 'invoice-pdfs'
          and (storage.foldername(name))[1] = public.current_tenant_id()::text
        )
    $p$;
  end if;
end $$;
-- Plan entitlements.
-- Platform plans billed to tenants live in plans, plan_features, and tenant_subscriptions.
-- public.subscriptions stays as the legacy mirror of tenant_subscriptions.
-- A tenant's own customers are public.customers. They do not have a subscription table.
-- Prices in price_*_paise are INR paise. price_monthly / price_yearly stay in rupees for existing clients.
-- New tenants start on free. Paid features are off until a subscription row says otherwise.
-- Keep the numbers aligned with web/src/config/pricing.ts.

alter table public.plans
  add column if not exists price_monthly_paise integer,
  add column if not exists price_yearly_paise integer,
  add column if not exists limits jsonb not null default '{}'::jsonb,
  add column if not exists active boolean not null default true;

update public.plans
set price_monthly_paise = coalesce(price_monthly_paise, (price_monthly * 100)::integer),
    price_yearly_paise = coalesce(price_yearly_paise, (price_yearly * 100)::integer);

alter table public.plans
  alter column price_monthly_paise set not null,
  alter column price_yearly_paise set not null;

alter table public.plans
  drop constraint if exists plans_paise_nonnegative;
alter table public.plans
  add constraint plans_paise_nonnegative check (price_monthly_paise >= 0 and price_yearly_paise >= 0);

insert into public.plans (
  id, code, name, description, price_monthly, price_yearly, price_monthly_paise, price_yearly_paise, sort_order, active
) values (
  '10000000-0000-4000-8000-000000000000',
  'free',
  'Free',
  'Basic invoices for one person.',
  0, 0, 0, 0, 0, true
)
on conflict (id) do nothing;

update public.plans set
  name = 'Starter',
  description = 'GST invoices, a product catalog, and WhatsApp click-to-chat.',
  price_monthly = 199,
  price_yearly = 1990,
  price_monthly_paise = 19900,
  price_yearly_paise = 199000,
  sort_order = 10,
  active = true,
  is_public = true
where code = 'starter';

update public.plans set
  name = 'Growth',
  description = 'Reminders, POS, online payments, roles, stock, and reports.',
  price_monthly = 499,
  price_yearly = 4990,
  price_monthly_paise = 49900,
  price_yearly_paise = 499000,
  sort_order = 20,
  active = true,
  is_public = true
where code = 'growth';

update public.plans set
  code = 'business',
  name = 'Business',
  description = 'Custom templates and domains, the WhatsApp API, and higher limits.',
  price_monthly = 1499,
  price_yearly = 14990,
  price_monthly_paise = 149900,
  price_yearly_paise = 1499000,
  sort_order = 30,
  active = true,
  is_public = true
where code = 'pro';

update public.plans set
  description = 'Custom templates and domains, the WhatsApp API, and higher limits.',
  price_monthly = 1499,
  price_yearly = 14990,
  price_monthly_paise = 149900,
  price_yearly_paise = 1499000,
  active = true
where code = 'business';

alter table public.tenants alter column plan set default 'free';

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------

create table if not exists public.features (
  key text primary key,
  name text not null,
  description text not null default ''
);

insert into public.features (key, name, description) values
  ('basic_invoices', 'Invoices', 'Create and send invoices'),
  ('public_site', 'Public site', 'A subdomain on the marketing host'),
  ('gst_invoices', 'GST invoices', 'Tax invoices, HSN, and place of supply'),
  ('product_catalog', 'Product catalog', 'Products with price and HSN'),
  ('whatsapp_click_to_chat', 'WhatsApp click-to-chat', 'A wa.me link with the invoice text'),
  ('whatsapp_sharing', 'WhatsApp Cloud API', 'Send an approved template through Meta'),
  ('upi_qr', 'UPI links', 'UPI payment links on invoices'),
  ('auto_reminders', 'Automatic reminders', 'Scheduled email, SMS, and WhatsApp reminders'),
  ('online_payments', 'Online payments', 'UPI QR at the counter and online collection'),
  ('pos', 'POS counter', 'Checkout that writes the invoice and the payment together'),
  ('multi_user_roles', 'Roles', 'Invite teammates with owner, admin, billing, and member roles'),
  ('stock_tracking', 'Stock', 'Track stock on products'),
  ('reporting_dashboard', 'Reports', 'GSTR-1 style summaries and the reporting view'),
  ('custom_templates', 'Custom templates', 'Publish a storefront template other than Classic'),
  ('custom_domains', 'Custom domains', 'Serve the public site on your own domain'),
  ('webhooks', 'Webhooks', 'Outbound invoice events'),
  ('audit_log', 'Audit log', 'A trail of billing changes'),
  ('api_access', 'API access', 'Use the API beyond the dashboard'),
  ('remove_branding', 'Remove branding', 'Hide billflow on the public site'),
  ('priority_support', 'Priority support', 'Priority support on Business'),
  ('max_users', 'User limit', 'Maximum members'),
  ('max_invoices_per_month', 'Invoice limit', 'Invoices created in the current month'),
  ('max_customers', 'Customer limit', 'Maximum customers'),
  ('max_products', 'Product limit', 'Maximum products'),
  ('max_custom_domains', 'Domain limit', 'Maximum custom domains')
on conflict (key) do update set name = excluded.name, description = excluded.description;

create table if not exists public.plan_features (
  plan_id uuid not null references public.plans (id) on delete cascade,
  feature_key text not null references public.features (key),
  enabled boolean not null default false,
  limit_value integer,
  primary key (plan_id, feature_key)
);

insert into public.plan_features (plan_id, feature_key, enabled, limit_value)
select p.id,
       f.key,
       case
         when f.key in ('basic_invoices', 'public_site') then true
         when f.key in ('gst_invoices', 'product_catalog', 'whatsapp_click_to_chat', 'upi_qr')
           and p.code in ('starter', 'growth', 'business') then true
         when f.key in (
           'auto_reminders', 'online_payments', 'pos', 'multi_user_roles', 'stock_tracking',
           'reporting_dashboard', 'webhooks', 'audit_log', 'api_access'
         ) and p.code in ('growth', 'business') then true
         when f.key in ('custom_templates', 'custom_domains', 'whatsapp_sharing', 'remove_branding', 'priority_support')
           and p.code = 'business' then true
         when f.key like 'max_%' then true
         else false
       end,
       case f.key
         when 'max_users' then case p.code when 'free' then 1 when 'starter' then 1 when 'growth' then 10 else null end
         when 'max_invoices_per_month' then case p.code when 'free' then 20 when 'starter' then 100 when 'growth' then 1000 else null end
         when 'max_customers' then case p.code when 'free' then 25 when 'starter' then 200 when 'growth' then 2000 else null end
         when 'max_products' then case p.code when 'free' then 0 when 'starter' then 100 when 'growth' then 2000 else null end
         when 'max_custom_domains' then case when p.code = 'business' then 5 else 0 end
         else null
       end
from public.plans p
cross join public.features f
on conflict (plan_id, feature_key) do update
  set enabled = excluded.enabled,
      limit_value = excluded.limit_value;

update public.plans p
set features = coalesce((
      select jsonb_object_agg(
        pf.feature_key,
        case when pf.feature_key like 'max_%' then to_jsonb(pf.limit_value) else to_jsonb(pf.enabled) end
      )
      from public.plan_features pf
      where pf.plan_id = p.id
    ), '{}'::jsonb),
    limits = coalesce((
      select jsonb_object_agg(pf.feature_key, to_jsonb(pf.limit_value))
      from public.plan_features pf
      where pf.plan_id = p.id
        and pf.feature_key like 'max_%'
    ), '{}'::jsonb);

update public.plans
set features = features || jsonb_build_object(
  'invoices_per_month', features -> 'max_invoices_per_month',
  'customers', features -> 'max_customers',
  'members', features -> 'max_users',
  'custom_domain', features -> 'custom_domains'
);

-- ---------------------------------------------------------------------------
-- The platform subscription. Distinct from anything a tenant bills its customers.
-- ---------------------------------------------------------------------------

create table if not exists public.tenant_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  plan_id uuid not null references public.plans (id),
  pending_plan_id uuid references public.plans (id),
  status public.subscription_status not null default 'trialing',
  billing_cycle public.billing_cycle not null default 'monthly',
  current_period_start date,
  current_period_end date,
  trial_ends_at timestamptz,
  cancel_at_period_end boolean not null default false,
  grace_until timestamptz,
  over_limit_grace boolean not null default false,
  provider text not null default 'manual',
  provider_customer_id text,
  provider_subscription_id text,
  price_paise integer not null default 0 check (price_paise >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists tenant_subscriptions_one_open
  on public.tenant_subscriptions (tenant_id)
  where status in ('trialing', 'active', 'past_due', 'paused');

create table if not exists public.tenant_feature_overrides (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  feature_key text not null references public.features (key),
  enabled boolean not null,
  note text,
  created_at timestamptz not null default now(),
  primary key (tenant_id, feature_key)
);

create table if not exists public.billing_checkouts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  plan_id uuid not null references public.plans (id),
  billing_cycle public.billing_cycle not null,
  amount_paise integer not null check (amount_paise >= 0),
  provider text not null,
  provider_order_id text,
  provider_payment_id text,
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists billing_checkouts_order_idx
  on public.billing_checkouts (provider, provider_order_id)
  where provider_order_id is not null;

create table if not exists public.billing_events (
  provider text not null,
  event_id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (provider, event_id)
);

create table if not exists public.platform_invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  subscription_id uuid references public.tenant_subscriptions (id) on delete set null,
  number text not null,
  taxable_paise integer not null,
  cgst_paise integer not null default 0,
  sgst_paise integer not null default 0,
  igst_paise integer not null default 0,
  total_paise integer not null,
  gst_rate numeric(5, 2) not null default 18,
  seller_gstin text,
  buyer_gstin text,
  place_of_supply text,
  provider_payment_id text unique,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Resolution
-- ---------------------------------------------------------------------------

create or replace function public.effective_plan_id(p_tenant uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  sub public.tenant_subscriptions;
  free_id uuid;
begin
  select id into free_id from public.plans where code = 'free';
  select * into sub
  from public.tenant_subscriptions
  where tenant_id = p_tenant
    and status in ('trialing', 'active', 'past_due', 'paused')
  order by created_at desc
  limit 1;

  if sub.id is null then
    return coalesce(
      (select p.id from public.tenants t join public.plans p on p.code = t.plan where t.id = p_tenant),
      free_id
    );
  end if;

  if sub.status = 'past_due' and sub.grace_until is not null and sub.grace_until < now() then
    return free_id;
  end if;

  return sub.plan_id;
end;
$$;

create or replace function public.has_feature(p_tenant uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select o.enabled
      from public.tenant_feature_overrides o
      where o.tenant_id = p_tenant and o.feature_key = p_key
    ),
    (
      select pf.enabled
      from public.plan_features pf
      where pf.plan_id = public.effective_plan_id(p_tenant)
        and pf.feature_key = p_key
    ),
    false
  );
$$;

create or replace function public.feature_limit(p_tenant uuid, p_key text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case
    when coalesce((
      select o.enabled from public.tenant_feature_overrides o
      where o.tenant_id = p_tenant and o.feature_key = p_key
    ), pf.enabled, false) then pf.limit_value
    else 0
  end
  from public.plan_features pf
  where pf.plan_id = public.effective_plan_id(p_tenant)
    and pf.feature_key = p_key;
$$;

create or replace function public.required_plan(p_key text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.code
  from public.plans p
  join public.plan_features pf on pf.plan_id = p.id
  where pf.feature_key = p_key
    and pf.enabled
    and p.is_public
    and p.active
    and pf.feature_key not like 'max_%'
  order by p.sort_order
  limit 1;
$$;

create or replace function public.tenant_entitlements(p_tenant uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  plan_id uuid;
  plan_code text;
  plan_name text;
  sub_status text;
  grace boolean;
  features jsonb;
begin
  if auth.role() is distinct from 'service_role' and not public.is_member_of(p_tenant) then
    raise exception 'not a member of this tenant' using errcode = '42501';
  end if;

  plan_id := public.effective_plan_id(p_tenant);
  select p.code, p.name into plan_code, plan_name from public.plans p where p.id = plan_id;

  select ts.status::text, ts.over_limit_grace
    into sub_status, grace
  from public.tenant_subscriptions ts
  where ts.tenant_id = p_tenant
    and ts.status in ('trialing', 'active', 'past_due', 'paused')
  order by ts.created_at desc
  limit 1;

  select coalesce(jsonb_object_agg(
    pf.feature_key,
    case
      when pf.feature_key like 'max_%' then to_jsonb(coalesce(o.enabled, pf.enabled))
      else to_jsonb(coalesce(o.enabled, pf.enabled))
    end
  ), '{}'::jsonb)
  into features
  from public.plan_features pf
  left join public.tenant_feature_overrides o
    on o.tenant_id = p_tenant and o.feature_key = pf.feature_key
  where pf.plan_id = plan_id;

  features := features || jsonb_build_object(
    'invoices_per_month', (
      select to_jsonb(pf.limit_value) from public.plan_features pf
      where pf.plan_id = plan_id and pf.feature_key = 'max_invoices_per_month'
    ),
    'customers', (
      select to_jsonb(pf.limit_value) from public.plan_features pf
      where pf.plan_id = plan_id and pf.feature_key = 'max_customers'
    ),
    'members', (
      select to_jsonb(pf.limit_value) from public.plan_features pf
      where pf.plan_id = plan_id and pf.feature_key = 'max_users'
    ),
    'custom_domain', coalesce(features -> 'custom_domains', 'false'::jsonb)
  );

  -- Limit keys expose the numeric cap, including null for unlimited.
  features := (
    select features || coalesce(jsonb_object_agg(pf.feature_key, to_jsonb(pf.limit_value)), '{}'::jsonb)
    from public.plan_features pf
    where pf.plan_id = plan_id and pf.feature_key like 'max_%'
  );

  return jsonb_build_object(
    'tenant_id', p_tenant,
    'plan', plan_code,
    'plan_name', plan_name,
    'subscription_status', sub_status,
    'over_limit_grace', coalesce(grace, false),
    'features', features
  );
end;
$$;

create or replace function public.usage_exceeds_plan(p_tenant uuid, p_plan uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  cap integer;
  used integer;
begin
  select limit_value into cap from public.plan_features
  where plan_id = p_plan and feature_key = 'max_invoices_per_month';
  if cap is not null then
    select count(*) into used from public.invoices
    where tenant_id = p_tenant and status <> 'void' and created_at >= date_trunc('month', now());
    if used > cap then return true; end if;
  end if;

  select limit_value into cap from public.plan_features where plan_id = p_plan and feature_key = 'max_customers';
  if cap is not null then
    select count(*) into used from public.customers where tenant_id = p_tenant;
    if used > cap then return true; end if;
  end if;

  select limit_value into cap from public.plan_features where plan_id = p_plan and feature_key = 'max_users';
  if cap is not null then
    select count(*) into used from public.memberships where tenant_id = p_tenant and status = 'active';
    if used > cap then return true; end if;
  end if;

  select limit_value into cap from public.plan_features where plan_id = p_plan and feature_key = 'max_products';
  if cap is not null then
    select count(*) into used from public.products where tenant_id = p_tenant;
    if used > cap then return true; end if;
  end if;

  select limit_value into cap from public.plan_features where plan_id = p_plan and feature_key = 'max_custom_domains';
  if cap is not null then
    select count(*) into used from public.tenant_domains where tenant_id = p_tenant;
    if used > cap then return true; end if;
  end if;

  return false;
end;
$$;

create or replace function public.apply_plan_transitions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer := 0;
  free_id uuid;
  rec record;
begin
  select id into free_id from public.plans where code = 'free';

  update public.tenant_subscriptions
  set plan_id = free_id,
      status = 'active',
      pending_plan_id = null,
      grace_until = null,
      over_limit_grace = true,
      price_paise = 0,
      provider = 'manual'
  where status = 'past_due'
    and grace_until is not null
    and grace_until < now();
  get diagnostics n = row_count;

  update public.tenant_subscriptions
  set pending_plan_id = free_id
  where cancel_at_period_end
    and pending_plan_id is null
    and current_period_end is not null
    and current_period_end < current_date
    and status in ('active', 'trialing');

  for rec in
    select * from public.tenant_subscriptions
    where pending_plan_id is not null
      and current_period_end is not null
      and current_period_end < current_date
      and status in ('active', 'trialing', 'past_due')
  loop
    update public.tenant_subscriptions
    set plan_id = rec.pending_plan_id,
        pending_plan_id = null,
        status = 'active',
        cancel_at_period_end = false,
        over_limit_grace = public.usage_exceeds_plan(rec.tenant_id, rec.pending_plan_id),
        price_paise = coalesce((select price_monthly_paise from public.plans where id = rec.pending_plan_id), 0)
    where id = rec.id;
    n := n + 1;
  end loop;

  update public.tenants t
  set plan = p.code
  from public.tenant_subscriptions ts
  join public.plans p on p.id = ts.plan_id
  where ts.tenant_id = t.id
    and ts.status in ('active', 'trialing', 'past_due', 'paused')
    and t.plan is distinct from p.code;

  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Keep subscriptions and tenant_subscriptions aligned. A recursion flag stops the loop.
-- ---------------------------------------------------------------------------

create or replace function public.sync_subscription_to_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('billflow.syncing', true) = '1' then
    return new;
  end if;
  perform set_config('billflow.syncing', '1', true);
  insert into public.tenant_subscriptions (
    id, tenant_id, plan_id, status, billing_cycle, current_period_start, current_period_end,
    trial_ends_at, cancel_at_period_end, provider, provider_subscription_id, price_paise
  ) values (
    new.id, new.tenant_id, new.plan_id, new.status, new.billing_cycle,
    new.current_period_start, new.current_period_end,
    case when new.status = 'trialing' then new.current_period_end::timestamptz else null end,
    new.cancel_at_period_end, new.provider, new.external_id, round(new.price * 100)::integer
  )
  on conflict (id) do update set
    plan_id = excluded.plan_id,
    status = excluded.status,
    billing_cycle = excluded.billing_cycle,
    current_period_start = excluded.current_period_start,
    current_period_end = excluded.current_period_end,
    cancel_at_period_end = excluded.cancel_at_period_end,
    provider = excluded.provider,
    provider_subscription_id = excluded.provider_subscription_id,
    price_paise = excluded.price_paise;
  update public.tenants
  set plan = (select code from public.plans where id = new.plan_id)
  where id = new.tenant_id;
  perform set_config('billflow.syncing', '', true);
  return new;
end;
$$;

create or replace function public.sync_tenant_to_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  plan_name text;
begin
  if current_setting('billflow.syncing', true) = '1' then
    return new;
  end if;
  perform set_config('billflow.syncing', '1', true);
  select name into plan_name from public.plans where id = new.plan_id;
  insert into public.subscriptions (
    id, tenant_id, plan_id, plan_name, price, currency, billing_cycle, status,
    start_date, current_period_start, current_period_end, cancel_at_period_end, provider, external_id
  ) values (
    new.id, new.tenant_id, new.plan_id, plan_name, new.price_paise / 100.0, 'INR',
    new.billing_cycle, new.status, coalesce(new.current_period_start, current_date),
    new.current_period_start, new.current_period_end, new.cancel_at_period_end,
    new.provider, new.provider_subscription_id
  )
  on conflict (id) do update set
    plan_id = excluded.plan_id,
    plan_name = excluded.plan_name,
    price = excluded.price,
    billing_cycle = excluded.billing_cycle,
    status = excluded.status,
    current_period_start = excluded.current_period_start,
    current_period_end = excluded.current_period_end,
    cancel_at_period_end = excluded.cancel_at_period_end,
    provider = excluded.provider,
    external_id = excluded.external_id;
  update public.tenants
  set plan = (select code from public.plans where id = new.plan_id)
  where id = new.tenant_id;
  perform set_config('billflow.syncing', '', true);
  return new;
end;
$$;

drop trigger if exists subscriptions_sync_tenant on public.subscriptions;
create trigger subscriptions_sync_tenant
  after insert or update on public.subscriptions
  for each row execute function public.sync_subscription_to_tenant();

drop trigger if exists tenant_subscriptions_sync_legacy on public.tenant_subscriptions;
create trigger tenant_subscriptions_sync_legacy
  after insert or update on public.tenant_subscriptions
  for each row execute function public.sync_tenant_to_subscription();

drop trigger if exists tenant_subscriptions_updated_at on public.tenant_subscriptions;
create trigger tenant_subscriptions_updated_at
  before update on public.tenant_subscriptions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Enforcement. These fire for every role, including service_role.
-- ---------------------------------------------------------------------------

create or replace function public.assert_not_over_limit(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.tenant_subscriptions
    where tenant_id = p_tenant
      and over_limit_grace
      and status in ('trialing', 'active', 'past_due', 'paused')
  ) then
    raise exception 'LIMIT_REACHED:over_limit_grace' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.enforce_over_limit_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_not_over_limit(new.tenant_id);
  return new;
end;
$$;

create or replace function public.enforce_product_entitlement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cap integer;
  used integer;
begin
  if not public.has_feature(new.tenant_id, 'product_catalog') then
    raise exception 'FEATURE_LOCKED:product_catalog' using errcode = '42501';
  end if;
  if new.stock is not null and not public.has_feature(new.tenant_id, 'stock_tracking') then
    raise exception 'FEATURE_LOCKED:stock_tracking' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    perform public.assert_not_over_limit(new.tenant_id);
    cap := public.feature_limit(new.tenant_id, 'max_products');
    if cap is not null then
      select count(*) into used from public.products where tenant_id = new.tenant_id;
      if used >= cap then
        raise exception 'LIMIT_REACHED:max_products' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.enforce_invoice_entitlement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cap integer;
  used integer;
begin
  if tg_op = 'INSERT' then
    perform public.assert_not_over_limit(new.tenant_id);
    if new.source = 'pos' and not public.has_feature(new.tenant_id, 'pos') then
      raise exception 'FEATURE_LOCKED:pos' using errcode = '42501';
    end if;
    cap := public.feature_limit(new.tenant_id, 'max_invoices_per_month');
    if cap is not null then
      select count(*) into used from public.invoices
      where tenant_id = new.tenant_id
        and status <> 'void'
        and created_at >= date_trunc('month', now());
      if used >= cap then
        raise exception 'LIMIT_REACHED:max_invoices_per_month' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.enforce_line_entitlement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.tax_rate, 0) > 0 and not public.has_feature(new.tenant_id, 'gst_invoices') then
    raise exception 'FEATURE_LOCKED:gst_invoices' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_domain_entitlement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cap integer;
  used integer;
begin
  if tg_op = 'INSERT' then
    if not public.has_feature(new.tenant_id, 'custom_domains') then
      raise exception 'FEATURE_LOCKED:custom_domains' using errcode = '42501';
    end if;
    perform public.assert_not_over_limit(new.tenant_id);
    cap := public.feature_limit(new.tenant_id, 'max_custom_domains');
    if cap is not null then
      select count(*) into used from public.tenant_domains where tenant_id = new.tenant_id;
      if used >= cap then
        raise exception 'LIMIT_REACHED:max_custom_domains' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.enforce_site_domain()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.custom_domain is not null
     and (tg_op = 'INSERT' or new.custom_domain is distinct from old.custom_domain)
     and not public.has_feature(new.tenant_id, 'custom_domains') then
    raise exception 'FEATURE_LOCKED:custom_domains' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_template_entitlement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  slug text;
begin
  if new.published_at is null then
    return new;
  end if;
  select t.slug into slug from public.templates t where t.id = new.template_id;
  if slug is distinct from 'classic' and not public.has_feature(new.tenant_id, 'custom_templates') then
    raise exception 'FEATURE_LOCKED:custom_templates' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists products_entitlement on public.products;
create trigger products_entitlement
  before insert or update on public.products
  for each row execute function public.enforce_product_entitlement();

drop trigger if exists invoices_entitlement on public.invoices;
create trigger invoices_entitlement
  before insert on public.invoices
  for each row execute function public.enforce_invoice_entitlement();

drop trigger if exists invoice_items_entitlement on public.invoice_items;
create trigger invoice_items_entitlement
  before insert or update on public.invoice_items
  for each row execute function public.enforce_line_entitlement();

drop trigger if exists domains_entitlement on public.tenant_domains;
create trigger domains_entitlement
  before insert on public.tenant_domains
  for each row execute function public.enforce_domain_entitlement();

drop trigger if exists sites_domain_entitlement on public.sites;
create trigger sites_domain_entitlement
  before insert or update on public.sites
  for each row execute function public.enforce_site_domain();

drop trigger if exists templates_entitlement on public.tenant_template_settings;
create trigger templates_entitlement
  before insert or update on public.tenant_template_settings
  for each row execute function public.enforce_template_entitlement();

drop trigger if exists customers_over_limit on public.customers;
create trigger customers_over_limit
  before insert on public.customers
  for each row execute function public.enforce_over_limit_insert();

drop trigger if exists memberships_over_limit on public.memberships;
create trigger memberships_over_limit
  before insert on public.memberships
  for each row execute function public.enforce_over_limit_insert();

-- Reminders only enqueue for tenants that still have the feature.
create or replace function public.enqueue_due_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  insert into public.reminder_jobs (
    tenant_id, invoice_id, schedule_id, channel, idempotency_key, status, next_attempt_at
  )
  select
    i.tenant_id,
    i.id,
    s.id,
    s.channel,
    i.id::text || ':' || s.id::text || ':' || ((i.due_at at time zone 'Asia/Kolkata')::date + s.offset_days)::text,
    'pending',
    now()
  from public.invoices i
  join public.reminder_schedules s on s.tenant_id = i.tenant_id and s.enabled
  join public.customers c on c.id = i.customer_id
  where i.status in ('sent', 'overdue')
    and i.due_at is not null
    and coalesce(c.reminder_opt_out, false) = false
    and public.has_feature(i.tenant_id, 'auto_reminders')
    and ((i.due_at at time zone 'Asia/Kolkata')::date + s.offset_days) <= (now() at time zone 'Asia/Kolkata')::date
    and ((i.due_at at time zone 'Asia/Kolkata')::date + s.offset_days) >= (now() at time zone 'Asia/Kolkata')::date - 3
  on conflict (tenant_id, idempotency_key) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Public sites: a custom domain requires the feature. A non-classic template falls back to Classic.
create or replace function public.get_site_by_host(p_host text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  h text := lower(rtrim(split_part(coalesce(p_host, ''), ':', 1), '.'));
  app_domain text;
  tid uuid;
  sub text;
  tname text;
  logo text;
  currency text;
  slug text;
  via_custom boolean;
  tmpl_slug text;
  tmpl_name text;
  base_config jsonb;
  published jsonb;
  published_at timestamptz;
  legacy_title text;
  legacy_tagline text;
  legacy_about text;
  legacy_published boolean;
begin
  if h = '' then
    return null;
  end if;

  select s.app_domain into app_domain from public.platform_settings s where s.id = 1;
  app_domain := lower(coalesce(app_domain, 'billflow.com'));

  select t.id, coalesce(t.subdomain, t.slug), t.slug, t.name, t.logo_url, t.currency,
         (d.id is not null or site.id is not null)
    into tid, sub, slug, tname, logo, currency, via_custom
  from public.tenants t
  left join public.tenant_domains d
    on d.tenant_id = t.id and d.verified and lower(d.domain) = h
  left join public.sites site
    on site.tenant_id = t.id and lower(site.custom_domain) = h
  where d.id is not null
     or site.id is not null
     or lower(coalesce(t.subdomain, t.slug)) = h
     or lower(coalesce(t.subdomain, t.slug)) || '.' || app_domain = h
     or lower(coalesce(t.subdomain, t.slug)) || '.localhost' = h
  order by case when d.id is not null or site.id is not null then 0 else 1 end
  limit 1;

  if tid is null then
    return null;
  end if;
  if via_custom and not public.has_feature(tid, 'custom_domains') then
    return null;
  end if;

  select ts.published_overrides, ts.published_at, tmpl.config, tmpl.slug, tmpl.name
    into published, published_at, base_config, tmpl_slug, tmpl_name
  from public.tenant_template_settings ts
  join public.templates tmpl on tmpl.id = ts.template_id
  where ts.tenant_id = tid
    and ts.published_at is not null;

  if published_at is not null then
    published := coalesce(published, '{}'::jsonb);
    base_config := coalesce(base_config, '{}'::jsonb);
    if tmpl_slug is distinct from 'classic' and not public.has_feature(tid, 'custom_templates') then
      select tmpl.config, tmpl.slug, tmpl.name
        into base_config, tmpl_slug, tmpl_name
      from public.templates tmpl
      where tmpl.slug = 'classic';
      published := published - 'colors' - 'fonts' - 'layout' - 'sections';
    end if;
    return jsonb_build_object(
      'tenant_id', tid,
      'slug', slug,
      'subdomain', sub,
      'name', tname,
      'title', coalesce(published ->> 'title', tname),
      'tagline', published ->> 'tagline',
      'about', published ->> 'about',
      'logo_url', coalesce(published ->> 'logo_url', logo),
      'published', true,
      'host', h,
      'currency', currency,
      'template', jsonb_build_object('slug', tmpl_slug, 'name', tmpl_name),
      'config', jsonb_build_object(
        'colors', coalesce(base_config -> 'colors', '{}'::jsonb) || coalesce(published -> 'colors', '{}'::jsonb),
        'fonts', coalesce(base_config -> 'fonts', '{}'::jsonb) || coalesce(published -> 'fonts', '{}'::jsonb),
        'layout', coalesce(base_config -> 'layout', '{}'::jsonb) || coalesce(published -> 'layout', '{}'::jsonb),
        'sections', case
          when jsonb_typeof(published -> 'sections') = 'array' then published -> 'sections'
          else coalesce(base_config -> 'sections', '[]'::jsonb)
        end
      )
    );
  end if;

  select site.title, site.tagline, site.about, site.published
    into legacy_title, legacy_tagline, legacy_about, legacy_published
  from public.sites site
  where site.tenant_id = tid;

  if coalesce(legacy_published, false) = false then
    return null;
  end if;

  return jsonb_build_object(
    'tenant_id', tid,
    'slug', slug,
    'subdomain', sub,
    'name', tname,
    'title', coalesce(legacy_title, tname),
    'tagline', legacy_tagline,
    'about', legacy_about,
    'logo_url', logo,
    'published', true,
    'host', h,
    'currency', currency,
    'template', jsonb_build_object('slug', 'classic', 'name', 'Classic'),
    'config', '{}'::jsonb
  );
end;
$$;

create or replace function public.create_tenant(p_name text, p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  t public.tenants;
  m public.memberships;
  plan_id uuid;
  reserved text[] := array['www', 'app', 'api', 'billing', 'admin', 'static', 'dashboard', 'auth', 'mail'];
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if not exists (select 1 from public.users where id = uid) then
    insert into public.users (id, email, name)
    select u.id,
           u.email,
           coalesce(u.raw_user_meta_data ->> 'name', u.raw_user_meta_data ->> 'full_name', split_part(u.email, '@', 1))
    from auth.users u
    where u.id = uid;
  end if;

  if p_name is null or char_length(btrim(p_name)) < 2 then
    raise exception 'name must be at least 2 characters' using errcode = '22023';
  end if;
  if p_slug is null or p_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'slug must be lowercase kebab-case' using errcode = '22023';
  end if;
  if p_slug = any (reserved) then
    raise exception 'slug is reserved' using errcode = '22023';
  end if;

  insert into public.tenants (name, slug, plan, status, currency)
  values (btrim(p_name), p_slug, 'free', 'trialing', 'INR')
  returning * into t;

  insert into public.memberships (tenant_id, user_id, role, status)
  values (t.id, uid, 'owner', 'active')
  returning * into m;

  update public.users
     set active_tenant_id = t.id,
         tenant_id = t.id,
         role = 'owner'
   where id = uid;

  insert into public.invoice_counters (tenant_id, prefix, next_number)
  values (t.id, 'INV', 1);

  insert into public.tax_rates (tenant_id, name, rate, tax_type, is_default)
  values
    (t.id, 'GST 0%', 0, 'exempt', true),
    (t.id, 'GST 5%', 5, 'gst', false),
    (t.id, 'GST 12%', 12, 'gst', false),
    (t.id, 'GST 18%', 18, 'gst', false),
    (t.id, 'GST 28%', 28, 'gst', false);

  select id into plan_id from public.plans where code = 'free';

  insert into public.subscriptions (
    tenant_id, plan_id, plan_name, price, currency, billing_cycle, status,
    start_date, current_period_start, current_period_end
  ) values (
    t.id, plan_id, 'Free', 0, 'INR', 'monthly', 'trialing',
    current_date, current_date, current_date + 14
  );

  insert into public.sites (tenant_id, title, tagline, published)
  values (t.id, btrim(p_name), 'Invoices and payments', false);

  return jsonb_build_object(
    'id', t.id,
    'name', t.name,
    'slug', t.slug,
    'plan', t.plan,
    'status', t.status,
    'currency', t.currency,
    'role', 'owner',
    'membership_id', m.id,
    'created_at', t.created_at
  );
end;
$$;

create or replace function public.invite_member(p_email text, p_role public.member_role)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  tid uuid := public.current_tenant_id();
  existing uuid;
  member_limit integer;
  member_count integer;
  m public.memberships;
  inv public.invitations;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if tid is null or not public.has_admin_access() then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('admin', 'billing', 'member') then
    raise exception 'role must be admin, billing, or member' using errcode = '22023';
  end if;
  if p_email is null or btrim(p_email) !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'a valid email is required' using errcode = '22023';
  end if;
  if not public.has_feature(tid, 'multi_user_roles') then
    raise exception 'FEATURE_LOCKED:multi_user_roles' using errcode = '42501';
  end if;

  member_limit := public.feature_limit(tid, 'max_users');
  if member_limit is not null then
    select count(*) into member_count
    from public.memberships ms
    where ms.tenant_id = tid
      and ms.status = 'active';
    if member_count >= member_limit then
      raise exception 'LIMIT_REACHED:max_users' using errcode = '42501';
    end if;
  end if;

  select u.id into existing
  from public.users u
  where lower(u.email) = lower(btrim(p_email));

  if existing is not null then
    if existing = uid and p_role::text is distinct from public.current_user_role() then
      raise exception 'cannot change your own role with invite_member' using errcode = '23514';
    end if;
    insert into public.memberships (tenant_id, user_id, role, status)
    values (tid, existing, p_role, 'active')
    on conflict (tenant_id, user_id) do update
      set role = excluded.role,
          status = 'active'
    returning * into m;
    return jsonb_build_object(
      'kind', 'membership',
      'membership_id', m.id,
      'user_id', m.user_id,
      'role', m.role,
      'status', m.status,
      'email', lower(btrim(p_email))
    );
  end if;

  insert into public.invitations (tenant_id, email, role, status, invited_by)
  values (tid, lower(btrim(p_email)), p_role, 'pending', uid)
  on conflict (tenant_id, lower(email)) where status = 'pending'
  do update set role = excluded.role, invited_by = excluded.invited_by, expires_at = now() + interval '14 days'
  returning * into inv;

  return jsonb_build_object(
    'kind', 'invitation',
    'invitation_id', inv.id,
    'email', inv.email,
    'role', inv.role,
    'status', inv.status,
    'expires_at', inv.expires_at
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS. Authenticated users can read the catalog and their own subscription.
-- Plan changes have no write policy. service_role bypasses RLS.
-- ---------------------------------------------------------------------------

alter table public.features enable row level security;
alter table public.plan_features enable row level security;
alter table public.tenant_subscriptions enable row level security;
alter table public.tenant_feature_overrides enable row level security;
alter table public.billing_checkouts enable row level security;
alter table public.billing_events enable row level security;
alter table public.platform_invoices enable row level security;

drop policy if exists features_read on public.features;
create policy features_read on public.features for select to anon, authenticated using (true);

drop policy if exists plan_features_read on public.plan_features;
create policy plan_features_read on public.plan_features for select to anon, authenticated using (true);

drop policy if exists tenant_subscriptions_select on public.tenant_subscriptions;
create policy tenant_subscriptions_select on public.tenant_subscriptions
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists overrides_select on public.tenant_feature_overrides;
create policy overrides_select on public.tenant_feature_overrides
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists checkouts_select on public.billing_checkouts;
create policy checkouts_select on public.billing_checkouts
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists platform_invoices_select on public.platform_invoices;
create policy platform_invoices_select on public.platform_invoices
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists subscriptions_write on public.subscriptions;

grant select on public.features, public.plan_features to anon, authenticated;
grant select on public.tenant_subscriptions, public.tenant_feature_overrides, public.billing_checkouts, public.platform_invoices to authenticated;
grant all privileges on public.features, public.plan_features, public.tenant_subscriptions, public.tenant_feature_overrides,
  public.billing_checkouts, public.billing_events, public.platform_invoices to service_role;

revoke all on function public.has_feature(uuid, text) from public, anon, authenticated;
revoke all on function public.feature_limit(uuid, text) from public, anon, authenticated;
revoke all on function public.effective_plan_id(uuid) from public, anon, authenticated;
revoke all on function public.usage_exceeds_plan(uuid, uuid) from public, anon, authenticated;
revoke all on function public.apply_plan_transitions() from public, anon, authenticated;
revoke all on function public.assert_not_over_limit(uuid) from public, anon, authenticated;
grant execute on function public.has_feature(uuid, text) to service_role;
grant execute on function public.feature_limit(uuid, text) to service_role;
grant execute on function public.effective_plan_id(uuid) to service_role;
grant execute on function public.tenant_entitlements(uuid) to authenticated, service_role;
grant execute on function public.required_plan(text) to authenticated, service_role;
grant execute on function public.apply_plan_transitions() to service_role;
revoke all on function public.enqueue_due_reminders() from public, anon, authenticated;
grant execute on function public.enqueue_due_reminders() to service_role;
revoke all on function public.get_site_by_host(text) from public;
grant execute on function public.get_site_by_host(text) to anon, authenticated, service_role;

comment on table public.tenant_subscriptions is
  'Platform plan billed to the tenant. Not the tenant''s own customer billing.';
comment on table public.subscriptions is
  'Legacy mirror of tenant_subscriptions. Writes from authenticated are revoked.';
-- UPI QR collect. Manual confirmation, not a payment gateway.
-- upi_qr on an invoice is available on every plan, including free.
-- A counter UPI sale still requires the pos feature.

alter table public.tenants
  add column if not exists upi_payee_name text;

alter table public.tenants drop constraint if exists tenants_upi_vpa_format;
alter table public.tenants
  add constraint tenants_upi_vpa_format check (
    upi_vpa is null or upi_vpa ~ '^[a-zA-Z0-9._-]{2,255}@[a-zA-Z]{2,64}$'
  );

alter table public.payments
  add column if not exists upi_utr text;

alter table public.payments drop constraint if exists payments_upi_utr_format;
alter table public.payments
  add constraint payments_upi_utr_format check (upi_utr is null or upi_utr ~ '^[0-9]{12}$');

alter type public.payment_method add value if not exists 'upi_qr';
alter type public.payment_status add value if not exists 'void';
alter type public.invoice_status add value if not exists 'partially_paid';

update public.plan_features pf
set enabled = true
from public.plans p
where pf.plan_id = p.id
  and pf.feature_key = 'upi_qr';

update public.plans
set features = jsonb_set(features, '{upi_qr}', 'true'::jsonb, true);

-- Invoice status machine now includes a partial payment.
create or replace function public.enforce_invoice_transition()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  subtotal numeric(12, 2);
  tax_sum numeric(12, 2);
  paid numeric(12, 2);
  allowed text[];
begin
  select coalesce(sum(line_subtotal), 0), coalesce(sum(tax_amount), 0)
    into subtotal, tax_sum
  from public.invoice_items
  where invoice_id = new.id;

  new.amount := subtotal;
  new.tax := tax_sum;
  new.total := round(new.amount + new.tax - coalesce(new.discount, 0), 2);

  if new.total < 0 then
    raise exception 'discount exceeds the invoice taxable value' using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' then
    if new.number is distinct from old.number then
      raise exception 'invoice number is immutable' using errcode = '23514';
    end if;
    if new.tenant_id is distinct from old.tenant_id then
      raise exception 'tenant_id is immutable' using errcode = '23514';
    end if;
    if old.status <> 'draft' and new.customer_id is distinct from old.customer_id then
      raise exception 'customer cannot change after the invoice leaves draft'
        using errcode = '23514';
    end if;

    if new.status is distinct from old.status then
      allowed := case old.status
        when 'draft' then array['draft', 'sent', 'void', 'paid', 'partially_paid']
        when 'sent' then array['sent', 'overdue', 'paid', 'partially_paid', 'void']
        when 'overdue' then array['overdue', 'sent', 'paid', 'partially_paid', 'void']
        when 'partially_paid' then array['partially_paid', 'paid', 'sent', 'overdue', 'void']
        when 'paid' then array['paid', 'void', 'sent', 'overdue', 'partially_paid']
        else array['void']
      end;
      if not (new.status::text = any (allowed)) then
        raise exception 'invalid invoice status transition from % to %', old.status, new.status
          using errcode = '23514';
      end if;
    end if;

    if new.status = 'sent' and old.status = 'draft' then
      new.issued_at := coalesce(new.issued_at, now());
      new.due_at := coalesce(new.due_at, now() + interval '15 days');
    end if;

    select coalesce(sum(amount), 0) into paid
    from public.payments
    where invoice_id = new.id
      and status = 'succeeded';

    if new.status = 'paid' and old.status is distinct from 'paid' then
      if paid < new.total then
        raise exception 'payments do not cover the invoice total' using errcode = '23514';
      end if;
      new.paid_at := coalesce(new.paid_at, now());
    end if;

    if old.status = 'paid' and new.status in ('sent', 'overdue', 'partially_paid') and paid >= new.total then
      raise exception 'invoice is fully paid' using errcode = '23514';
    end if;

    if new.status = 'void' and old.status is distinct from 'void' then
      if exists (
        select 1 from public.payments
        where invoice_id = new.id and status = 'succeeded'
      ) then
        raise exception 'refund payments before voiding an invoice' using errcode = '23514';
      end if;
    end if;

    if new.status is distinct from 'paid' then
      if old.status = 'paid' and new.status <> 'paid' then
        new.paid_at := null;
      end if;
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.sync_invoice_payment_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  inv uuid := coalesce(new.invoice_id, old.invoice_id);
  paid numeric(12, 2);
  tot numeric(12, 2);
  st public.invoice_status;
  stamp timestamptz := now();
begin
  if tg_op <> 'DELETE' and new.paid_at is not null then
    stamp := new.paid_at;
  end if;

  select coalesce(sum(amount), 0) into paid
  from public.payments
  where invoice_id = inv
    and status = 'succeeded';

  select total, status into tot, st
  from public.invoices
  where id = inv;

  if st = 'void' then
    return coalesce(new, old);
  end if;

  if tot is not null and paid >= tot then
    update public.invoices
       set status = 'paid',
           paid_at = coalesce(paid_at, stamp)
     where id = inv
       and status is distinct from 'paid';
  elsif paid > 0 then
    update public.invoices
       set status = 'partially_paid',
           paid_at = null
     where id = inv
       and status is distinct from 'partially_paid';
  elsif st in ('paid', 'partially_paid') then
    update public.invoices
       set status = case when due_at is not null and due_at < now() then 'overdue'::public.invoice_status else 'sent'::public.invoice_status end,
           paid_at = null
     where id = inv;
  end if;

  return coalesce(new, old);
end;
$$;

create or replace function public.confirm_upi_payment(p_payment uuid, p_utr text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pay public.payments;
  inv public.invoices;
begin
  if auth.uid() is null or not public.has_billing_access() then
    raise exception 'billing access required' using errcode = '42501';
  end if;
  if p_utr is not null and btrim(p_utr) <> '' and btrim(p_utr) !~ '^[0-9]{12}$' then
    raise exception 'UTR must be 12 digits' using errcode = '22023';
  end if;

  update public.payments
     set status = 'succeeded',
         upi_utr = nullif(btrim(coalesce(p_utr, '')), ''),
         paid_at = now()
   where id = p_payment
     and tenant_id = public.current_tenant_id()
     and method = 'upi_qr'
     and status = 'pending'
  returning * into pay;

  if pay.id is null then
    raise exception 'pending UPI payment not found' using errcode = 'P0002';
  end if;

  select * into inv from public.invoices where id = pay.invoice_id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    pay.tenant_id,
    auth.uid(),
    'upi.confirmed',
    'payments',
    pay.id,
    jsonb_build_object('invoice_id', pay.invoice_id, 'amount', pay.amount, 'tr', pay.transaction_ref, 'utr', pay.upi_utr)
  );

  return jsonb_build_object(
    'payment_id', pay.id,
    'invoice_id', inv.id,
    'invoice_status', inv.status,
    'amount', pay.amount,
    'utr', pay.upi_utr
  );
end;
$$;

create or replace function public.void_upi_payment(p_payment uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pay public.payments;
begin
  if auth.uid() is null or not public.has_billing_access() then
    raise exception 'billing access required' using errcode = '42501';
  end if;

  update public.payments
     set status = 'void'
   where id = p_payment
     and tenant_id = public.current_tenant_id()
     and method = 'upi_qr'
     and status = 'pending'
  returning * into pay;

  if pay.id is null then
    raise exception 'pending UPI payment not found' using errcode = 'P0002';
  end if;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    pay.tenant_id,
    auth.uid(),
    'upi.voided',
    'payments',
    pay.id,
    jsonb_build_object('invoice_id', pay.invoice_id, 'amount', pay.amount, 'tr', pay.transaction_ref)
  );

  return jsonb_build_object('payment_id', pay.id, 'status', pay.status);
end;
$$;

-- POS UPI stays pending until the cashier confirms the money arrived.
create or replace function public.pos_checkout(
  p_customer_id uuid,
  p_lines jsonb,
  p_method public.payment_method,
  p_supply public.supply_type,
  p_place text,
  p_tendered numeric
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  tid uuid := public.current_tenant_id();
  inv public.invoices;
  pay public.payments;
  line jsonb;
  idx integer := 0;
  tr text;
begin
  if uid is null or tid is null or not public.has_billing_access() then
    raise exception 'billing access required' using errcode = '42501';
  end if;
  if p_customer_id is null or jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) < 1 then
    raise exception 'customer and at least one line are required' using errcode = '22023';
  end if;

  insert into public.invoices (
    tenant_id, customer_id, supply_type, place_of_supply, source, document_type, status
  ) values (
    tid, p_customer_id, p_supply, p_place, 'pos',
    case when exists (
      select 1 from jsonb_array_elements(p_lines) e where coalesce((e ->> 'gst_rate')::numeric, 0) > 0
    ) then 'tax_invoice' else 'bill_of_supply' end,
    'draft'
  ) returning * into inv;

  for line in select * from jsonb_array_elements(p_lines)
  loop
    idx := idx + 1;
    insert into public.invoice_items (
      tenant_id, invoice_id, description, quantity, unit_price, discount, tax_rate, hsn_sac, unit, sort_order
    ) values (
      tid,
      inv.id,
      line ->> 'description',
      (line ->> 'quantity')::numeric,
      (line ->> 'unit_price')::numeric,
      coalesce((line ->> 'discount')::numeric, 0),
      coalesce((line ->> 'gst_rate')::numeric, 0),
      line ->> 'hsn_sac',
      coalesce(line ->> 'unit', 'NOS'),
      idx
    );
    if (line ->> 'product_id') is not null and (line ->> 'quantity') is not null then
      update public.products
         set stock = stock - (line ->> 'quantity')::numeric
       where id = (line ->> 'product_id')::uuid
         and tenant_id = tid
         and stock is not null;
    end if;
  end loop;

  select * into inv from public.invoices where id = inv.id;
  tr := 'BF' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);

  if p_method = 'upi' then
    insert into public.payments (
      tenant_id, invoice_id, amount, method, status, transaction_ref
    ) values (
      tid, inv.id, inv.total, 'upi_qr', 'pending', tr
    ) returning * into pay;
  else
    insert into public.payments (
      tenant_id, invoice_id, amount, method, status, tendered, change_amount, paid_at, transaction_ref
    ) values (
      tid,
      inv.id,
      inv.total,
      p_method,
      'succeeded',
      p_tendered,
      case when p_method = 'cash' and p_tendered is not null then greatest(p_tendered - inv.total, 0) else null end,
      now(),
      tr
    ) returning * into pay;
  end if;

  select * into inv from public.invoices where id = inv.id;
  return jsonb_build_object(
    'invoice_id', inv.id,
    'number', inv.number,
    'total', inv.total,
    'status', inv.status,
    'payment_id', pay.id,
    'payment_status', pay.status,
    'upi_tr', pay.transaction_ref
  );
end;
$$;

create or replace function public.get_shared_invoice(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  share public.invoice_shares;
  inv public.invoices;
  seller public.tenants;
  buyer public.customers;
  lines jsonb;
  pending public.payments;
begin
  select * into share from public.invoice_shares s
  where s.token = p_token and s.revoked_at is null and s.expires_at > now();
  if not found then
    return null;
  end if;
  select * into inv from public.invoices where id = share.invoice_id;
  select * into seller from public.tenants where id = inv.tenant_id;
  select * into buyer from public.customers where id = inv.customer_id;
  select * into pending from public.payments p
  where p.invoice_id = inv.id and p.method = 'upi_qr' and p.status = 'pending'
  order by p.created_at desc
  limit 1;
  select coalesce(jsonb_agg(jsonb_build_object(
    'description', it.description,
    'hsn_sac', it.hsn_sac,
    'quantity', it.quantity,
    'unit', it.unit,
    'unit_price', it.unit_price,
    'discount', it.discount,
    'tax_rate', it.tax_rate,
    'cgst_amount', it.cgst_amount,
    'sgst_amount', it.sgst_amount,
    'igst_amount', it.igst_amount,
    'line_total', it.line_total
  ) order by it.sort_order), '[]'::jsonb)
    into lines
  from public.invoice_items it where it.invoice_id = inv.id;

  return jsonb_build_object(
    'number', inv.number,
    'document_type', inv.document_type,
    'status', inv.status,
    'supply_type', inv.supply_type,
    'place_of_supply', inv.place_of_supply,
    'currency', inv.currency,
    'issued_at', inv.issued_at,
    'due_at', inv.due_at,
    'amount', inv.amount,
    'tax', inv.tax,
    'discount', inv.discount,
    'cgst_total', inv.cgst_total,
    'sgst_total', inv.sgst_total,
    'igst_total', inv.igst_total,
    'total', inv.total,
    'amount_in_words', inv.amount_in_words,
    'irn', inv.irn,
    'ack_no', inv.ack_no,
    'seller', jsonb_build_object(
      'name', coalesce(seller.legal_name, seller.name),
      'gstin', seller.gstin,
      'state_code', seller.state_code,
      'address', seller.address_line1,
      'upi_vpa', seller.upi_vpa,
      'upi_payee_name', coalesce(seller.upi_payee_name, seller.legal_name, seller.name)
    ),
    'upi', case when pending.id is null or seller.upi_vpa is null then null else jsonb_build_object(
      'pa', seller.upi_vpa,
      'pn', coalesce(seller.upi_payee_name, seller.legal_name, seller.name),
      'am', pending.amount,
      'tn', left('Invoice ' || inv.number, 50),
      'tr', pending.transaction_ref
    ) end,
    'buyer', jsonb_build_object(
      'name', buyer.name,
      'gstin', buyer.gstin,
      'state_code', buyer.billing_state_code
    ),
    'items', lines
  );
end;
$$;

revoke all on function public.confirm_upi_payment(uuid, text) from public, anon;
revoke all on function public.void_upi_payment(uuid) from public, anon;
grant execute on function public.confirm_upi_payment(uuid, text) to authenticated, service_role;
grant execute on function public.void_upi_payment(uuid) to authenticated, service_role;
grant execute on function public.pos_checkout(uuid, jsonb, public.payment_method, public.supply_type, text, numeric)
  to authenticated, service_role;
grant execute on function public.get_shared_invoice(text) to anon, authenticated, service_role;
-- Cash tender on every plan. amount_tendered is what the customer handed over.
-- change_given is what the cashier handed back, and may be less than the extra.
-- recorded_by is the cashier. Cash is not gated.

alter table public.payments
  add column if not exists amount_tendered numeric(12, 2),
  add column if not exists change_given numeric(12, 2),
  add column if not exists recorded_by uuid references public.users (id) on delete set null;

alter table public.payments drop constraint if exists payments_cash_nonnegative;
alter table public.payments
  add constraint payments_cash_nonnegative check (
    (amount_tendered is null or amount_tendered >= 0)
    and (change_given is null or change_given >= 0)
  );

insert into public.features (key, name, description) values
  ('cash_payments', 'Cash', 'Record cash with the amount received and the change given')
on conflict (key) do update set name = excluded.name, description = excluded.description;

insert into public.plan_features (plan_id, feature_key, enabled, limit_value)
select p.id, 'cash_payments', true, null
from public.plans p
on conflict (plan_id, feature_key) do update set enabled = true;

update public.plans
set features = jsonb_set(features, '{cash_payments}', 'true'::jsonb, true);

drop function if exists public.pos_checkout(uuid, jsonb, public.payment_method, public.supply_type, text, numeric);

create or replace function public.pos_checkout(
  p_customer_id uuid,
  p_lines jsonb,
  p_method public.payment_method,
  p_supply public.supply_type,
  p_place text,
  p_tendered numeric default null,
  p_change numeric default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  tid uuid := public.current_tenant_id();
  inv public.invoices;
  pay public.payments;
  line jsonb;
  idx integer := 0;
  tr text;
  change_due numeric(12, 2);
begin
  if uid is null or tid is null or not public.has_billing_access() then
    raise exception 'billing access required' using errcode = '42501';
  end if;
  if p_customer_id is null or jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) < 1 then
    raise exception 'customer and at least one line are required' using errcode = '22023';
  end if;

  insert into public.invoices (
    tenant_id, customer_id, supply_type, place_of_supply, source, document_type, status
  ) values (
    tid, p_customer_id, p_supply, p_place, 'pos',
    case when exists (
      select 1 from jsonb_array_elements(p_lines) e where coalesce((e ->> 'gst_rate')::numeric, 0) > 0
    ) then 'tax_invoice' else 'bill_of_supply' end,
    'draft'
  ) returning * into inv;

  for line in select * from jsonb_array_elements(p_lines)
  loop
    idx := idx + 1;
    insert into public.invoice_items (
      tenant_id, invoice_id, description, quantity, unit_price, discount, tax_rate, hsn_sac, unit, sort_order
    ) values (
      tid,
      inv.id,
      line ->> 'description',
      (line ->> 'quantity')::numeric,
      (line ->> 'unit_price')::numeric,
      coalesce((line ->> 'discount')::numeric, 0),
      coalesce((line ->> 'gst_rate')::numeric, 0),
      line ->> 'hsn_sac',
      coalesce(line ->> 'unit', 'NOS'),
      idx
    );
    if (line ->> 'product_id') is not null and (line ->> 'quantity') is not null then
      update public.products
         set stock = stock - (line ->> 'quantity')::numeric
       where id = (line ->> 'product_id')::uuid
         and tenant_id = tid
         and stock is not null;
    end if;
  end loop;

  select * into inv from public.invoices where id = inv.id;
  tr := 'BF' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);

  if p_method = 'upi' then
    insert into public.payments (
      tenant_id, invoice_id, amount, method, status, transaction_ref, recorded_by
    ) values (
      tid, inv.id, inv.total, 'upi_qr', 'pending', tr, uid
    ) returning * into pay;
  elsif p_method = 'cash' then
    if p_tendered is null or p_tendered + 0.001 < inv.total then
      raise exception 'cash received must cover the amount due' using errcode = '22023';
    end if;
    change_due := round(p_tendered - inv.total, 2);
    if p_change is not null and (p_change < 0 or p_change > change_due + 0.001) then
      raise exception 'change cannot be more than the extra cash' using errcode = '22023';
    end if;
    insert into public.payments (
      tenant_id, invoice_id, amount, method, status,
      tendered, change_amount, amount_tendered, change_given,
      paid_at, transaction_ref, recorded_by
    ) values (
      tid, inv.id, inv.total, 'cash', 'succeeded',
      p_tendered, coalesce(p_change, change_due), p_tendered, coalesce(p_change, change_due),
      now(), tr, uid
    ) returning * into pay;
  else
    insert into public.payments (
      tenant_id, invoice_id, amount, method, status, paid_at, transaction_ref, recorded_by
    ) values (
      tid, inv.id, inv.total, p_method, 'succeeded', now(), tr, uid
    ) returning * into pay;
  end if;

  select * into inv from public.invoices where id = inv.id;
  return jsonb_build_object(
    'invoice_id', inv.id,
    'number', inv.number,
    'total', inv.total,
    'status', inv.status,
    'payment_id', pay.id,
    'payment_status', pay.status,
    'upi_tr', pay.transaction_ref,
    'amount_tendered', pay.amount_tendered,
    'change_given', pay.change_given
  );
end;
$$;

grant execute on function public.pos_checkout(uuid, jsonb, public.payment_method, public.supply_type, text, numeric, numeric)
  to authenticated, service_role;
-- Per-tenant Razorpay, used when a tenant collects from their own customer.
-- This is not the platform subscription account in RAZORPAY_KEY_*.
-- key_secret and webhook_secret are AES-GCM ciphertext. Authenticated cannot select them.

alter type public.payment_method add value if not exists 'razorpay';

create table if not exists public.tenant_razorpay (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  key_id text not null,
  key_secret_enc text not null,
  webhook_secret_enc text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.payments
  add column if not exists provider_order_id text,
  add column if not exists provider_link_id text,
  add column if not exists provider_payment_id text;

create table if not exists public.tenant_gateway_events (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  event_id text not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, event_id)
);

alter table public.tenant_razorpay enable row level security;
alter table public.tenant_gateway_events enable row level security;

drop policy if exists tenant_razorpay_select on public.tenant_razorpay;
create policy tenant_razorpay_select on public.tenant_razorpay
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists tenant_razorpay_write on public.tenant_razorpay;
create policy tenant_razorpay_write on public.tenant_razorpay
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_admin_access())
  with check (tenant_id = public.current_tenant_id() and public.has_admin_access());

grant select, insert, update, delete on public.tenant_razorpay to authenticated;
grant all privileges on public.tenant_razorpay, public.tenant_gateway_events to service_role;

revoke select (key_secret_enc) on public.tenant_razorpay from authenticated, anon;
revoke select (webhook_secret_enc) on public.tenant_razorpay from authenticated, anon;

create or replace function public.pos_checkout(
  p_customer_id uuid,
  p_lines jsonb,
  p_method public.payment_method,
  p_supply public.supply_type,
  p_place text,
  p_tendered numeric default null,
  p_change numeric default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  tid uuid := public.current_tenant_id();
  inv public.invoices;
  pay public.payments;
  line jsonb;
  idx integer := 0;
  tr text;
  change_due numeric(12, 2);
begin
  if uid is null or tid is null or not public.has_billing_access() then
    raise exception 'billing access required' using errcode = '42501';
  end if;
  if p_customer_id is null or jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) < 1 then
    raise exception 'customer and at least one line are required' using errcode = '22023';
  end if;

  insert into public.invoices (
    tenant_id, customer_id, supply_type, place_of_supply, source, document_type, status
  ) values (
    tid, p_customer_id, p_supply, p_place, 'pos',
    case when exists (
      select 1 from jsonb_array_elements(p_lines) e where coalesce((e ->> 'gst_rate')::numeric, 0) > 0
    ) then 'tax_invoice' else 'bill_of_supply' end,
    'draft'
  ) returning * into inv;

  for line in select * from jsonb_array_elements(p_lines)
  loop
    idx := idx + 1;
    insert into public.invoice_items (
      tenant_id, invoice_id, description, quantity, unit_price, discount, tax_rate, hsn_sac, unit, sort_order
    ) values (
      tid,
      inv.id,
      line ->> 'description',
      (line ->> 'quantity')::numeric,
      (line ->> 'unit_price')::numeric,
      coalesce((line ->> 'discount')::numeric, 0),
      coalesce((line ->> 'gst_rate')::numeric, 0),
      line ->> 'hsn_sac',
      coalesce(line ->> 'unit', 'NOS'),
      idx
    );
    if (line ->> 'product_id') is not null and (line ->> 'quantity') is not null then
      update public.products
         set stock = stock - (line ->> 'quantity')::numeric
       where id = (line ->> 'product_id')::uuid
         and tenant_id = tid
         and stock is not null;
    end if;
  end loop;

  select * into inv from public.invoices where id = inv.id;
  tr := 'BF' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);

  if p_method = 'upi' then
    insert into public.payments (
      tenant_id, invoice_id, amount, method, status, transaction_ref, recorded_by
    ) values (
      tid, inv.id, inv.total, 'upi_qr', 'pending', tr, uid
    ) returning * into pay;
  elsif p_method = 'razorpay' then
    insert into public.payments (
      tenant_id, invoice_id, amount, method, status, transaction_ref, recorded_by
    ) values (
      tid, inv.id, inv.total, 'razorpay', 'pending', tr, uid
    ) returning * into pay;
  elsif p_method = 'cash' then
    if p_tendered is null or p_tendered + 0.001 < inv.total then
      raise exception 'cash received must cover the amount due' using errcode = '22023';
    end if;
    change_due := round(p_tendered - inv.total, 2);
    if p_change is not null and (p_change < 0 or p_change > change_due + 0.001) then
      raise exception 'change cannot be more than the extra cash' using errcode = '22023';
    end if;
    insert into public.payments (
      tenant_id, invoice_id, amount, method, status,
      tendered, change_amount, amount_tendered, change_given,
      paid_at, transaction_ref, recorded_by
    ) values (
      tid, inv.id, inv.total, 'cash', 'succeeded',
      p_tendered, coalesce(p_change, change_due), p_tendered, coalesce(p_change, change_due),
      now(), tr, uid
    ) returning * into pay;
  else
    insert into public.payments (
      tenant_id, invoice_id, amount, method, status, paid_at, transaction_ref, recorded_by
    ) values (
      tid, inv.id, inv.total, p_method, 'succeeded', now(), tr, uid
    ) returning * into pay;
  end if;

  select * into inv from public.invoices where id = inv.id;
  return jsonb_build_object(
    'invoice_id', inv.id,
    'number', inv.number,
    'total', inv.total,
    'status', inv.status,
    'payment_id', pay.id,
    'payment_status', pay.status,
    'upi_tr', pay.transaction_ref,
    'amount_tendered', pay.amount_tendered,
    'change_given', pay.change_given
  );
end;
$$;
-- Qualify plan_id. A PL/pgSQL variable with that name made
-- "where pf.plan_id = plan_id" ambiguous, so entitlements and limit checks failed.

create or replace function public.tenant_entitlements(p_tenant uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  resolved_plan uuid;
  plan_code text;
  plan_name text;
  sub_status text;
  grace boolean;
  features jsonb;
begin
  if auth.role() is distinct from 'service_role' and not public.is_member_of(p_tenant) then
    raise exception 'not a member of this tenant' using errcode = '42501';
  end if;

  resolved_plan := public.effective_plan_id(p_tenant);
  select p.code, p.name into plan_code, plan_name
  from public.plans p
  where p.id = resolved_plan;

  select ts.status::text, ts.over_limit_grace
    into sub_status, grace
  from public.tenant_subscriptions ts
  where ts.tenant_id = p_tenant
    and ts.status in ('trialing', 'active', 'past_due', 'paused')
  order by ts.created_at desc
  limit 1;

  select coalesce(jsonb_object_agg(
    pf.feature_key,
    to_jsonb(coalesce(o.enabled, pf.enabled))
  ), '{}'::jsonb)
  into features
  from public.plan_features pf
  left join public.tenant_feature_overrides o
    on o.tenant_id = p_tenant and o.feature_key = pf.feature_key
  where pf.plan_id = resolved_plan;

  features := features || jsonb_build_object(
    'invoices_per_month', (
      select to_jsonb(pf.limit_value) from public.plan_features pf
      where pf.plan_id = resolved_plan and pf.feature_key = 'max_invoices_per_month'
    ),
    'customers', (
      select to_jsonb(pf.limit_value) from public.plan_features pf
      where pf.plan_id = resolved_plan and pf.feature_key = 'max_customers'
    ),
    'members', (
      select to_jsonb(pf.limit_value) from public.plan_features pf
      where pf.plan_id = resolved_plan and pf.feature_key = 'max_users'
    ),
    'custom_domain', coalesce(features -> 'custom_domains', 'false'::jsonb)
  );

  features := (
    select features || coalesce(jsonb_object_agg(pf.feature_key, to_jsonb(pf.limit_value)), '{}'::jsonb)
    from public.plan_features pf
    where pf.plan_id = resolved_plan and pf.feature_key like 'max_%'
  );

  return jsonb_build_object(
    'tenant_id', p_tenant,
    'plan', plan_code,
    'plan_name', plan_name,
    'subscription_status', sub_status,
    'over_limit_grace', coalesce(grace, false),
    'features', features
  );
end;
$$;

create or replace function public.usage_exceeds_plan(p_tenant uuid, p_plan uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  cap integer;
  used integer;
begin
  select pf.limit_value into cap
  from public.plan_features pf
  where pf.plan_id = p_plan and pf.feature_key = 'max_invoices_per_month';
  if cap is not null then
    select count(*) into used from public.invoices i
    where i.tenant_id = p_tenant and i.status <> 'void' and i.created_at >= date_trunc('month', now());
    if used > cap then return true; end if;
  end if;

  select pf.limit_value into cap from public.plan_features pf
  where pf.plan_id = p_plan and pf.feature_key = 'max_customers';
  if cap is not null then
    select count(*) into used from public.customers c where c.tenant_id = p_tenant;
    if used > cap then return true; end if;
  end if;

  select pf.limit_value into cap from public.plan_features pf
  where pf.plan_id = p_plan and pf.feature_key = 'max_users';
  if cap is not null then
    select count(*) into used from public.memberships m
    where m.tenant_id = p_tenant and m.status = 'active';
    if used > cap then return true; end if;
  end if;

  select pf.limit_value into cap from public.plan_features pf
  where pf.plan_id = p_plan and pf.feature_key = 'max_products';
  if cap is not null then
    select count(*) into used from public.products pr where pr.tenant_id = p_tenant;
    if used > cap then return true; end if;
  end if;

  select pf.limit_value into cap from public.plan_features pf
  where pf.plan_id = p_plan and pf.feature_key = 'max_custom_domains';
  if cap is not null then
    select count(*) into used from public.tenant_domains d where d.tenant_id = p_tenant;
    if used > cap then return true; end if;
  end if;

  return false;
end;
$$;

create or replace function public.feature_limit(p_tenant uuid, p_key text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case
    when coalesce((
      select o.enabled from public.tenant_feature_overrides o
      where o.tenant_id = p_tenant and o.feature_key = p_key
    ), pf.enabled, false) then pf.limit_value
    else 0
  end
  from public.plan_features pf
  where pf.plan_id = public.effective_plan_id(p_tenant)
    and pf.feature_key = p_key;
$$;

alter table public.messaging_settings
  add column if not exists secrets_enc text;

revoke select (secrets_enc) on public.messaging_settings from authenticated, anon;
-- User-facing checkout and messaging settings run as the caller.
-- Authenticated cannot select messaging ciphertext, so owner/admin RPCs
-- return only secret flags and accept ciphertext the API already encrypted.

alter table public.messaging_settings
  add column if not exists secrets_flags jsonb not null default '{}'::jsonb;

create or replace function public.record_billing_checkout(
  p_plan_id uuid,
  p_billing_cycle public.billing_cycle,
  p_amount_paise integer,
  p_provider text,
  p_provider_order_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.billing_checkouts;
begin
  if public.current_tenant_id() is null or not public.has_admin_access() then
    raise exception 'Owner or admin role is required' using errcode = '42501';
  end if;
  if p_amount_paise < 0 then
    raise exception 'amount must be non-negative' using errcode = '22023';
  end if;

  insert into public.billing_checkouts (
    tenant_id, plan_id, billing_cycle, amount_paise, provider, provider_order_id, status
  ) values (
    public.current_tenant_id(), p_plan_id, p_billing_cycle, p_amount_paise, p_provider, p_provider_order_id, 'pending'
  )
  returning * into row;

  return to_jsonb(row);
end;
$$;

create or replace function public.activate_platform_checkout(
  p_order_id text,
  p_payment_id text,
  p_taxable_paise integer,
  p_cgst_paise integer,
  p_sgst_paise integer,
  p_igst_paise integer,
  p_total_paise integer,
  p_place_of_supply text,
  p_seller_gstin text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  checkout public.billing_checkouts;
  chosen public.plans;
  buyer text;
  sub_id uuid;
  existing_id uuid;
  period_start date := current_date;
  period_end date;
begin
  if auth.role() is distinct from 'service_role' then
    if public.current_tenant_id() is null or not public.has_admin_access() then
      raise exception 'Owner or admin role is required' using errcode = '42501';
    end if;
  end if;

  select * into checkout from public.billing_checkouts where provider_order_id = p_order_id;
  if checkout.id is null then
    raise exception 'Checkout not found' using errcode = 'P0002';
  end if;
  if auth.role() is distinct from 'service_role'
     and checkout.tenant_id is distinct from public.current_tenant_id() then
    raise exception 'Owner or admin role is required' using errcode = '42501';
  end if;
  if checkout.status = 'paid' then
    return jsonb_build_object('activated', false, 'duplicate', true);
  end if;

  select * into chosen from public.plans where id = checkout.plan_id;
  select t.gstin into buyer from public.tenants t where t.id = checkout.tenant_id;
  period_end := period_start + case when checkout.billing_cycle = 'yearly' then 365 else 30 end;

  select ts.id into existing_id
  from public.tenant_subscriptions ts
  where ts.tenant_id = checkout.tenant_id
    and ts.status in ('trialing', 'active', 'past_due', 'paused')
  order by ts.created_at desc
  limit 1;

  if existing_id is not null then
    update public.tenant_subscriptions
    set plan_id = chosen.id,
        pending_plan_id = null,
        status = 'active',
        billing_cycle = checkout.billing_cycle,
        current_period_start = period_start,
        current_period_end = period_end,
        cancel_at_period_end = false,
        grace_until = null,
        over_limit_grace = false,
        provider = checkout.provider,
        provider_subscription_id = p_payment_id,
        price_paise = p_taxable_paise
    where id = existing_id
    returning id into sub_id;
  else
    insert into public.tenant_subscriptions (
      tenant_id, plan_id, status, billing_cycle, current_period_start, current_period_end,
      cancel_at_period_end, provider, provider_subscription_id, price_paise
    ) values (
      checkout.tenant_id, chosen.id, 'active', checkout.billing_cycle, period_start, period_end,
      false, checkout.provider, p_payment_id, p_taxable_paise
    )
    returning id into sub_id;
  end if;

  update public.tenants
  set plan = chosen.code, status = 'active'
  where id = checkout.tenant_id;

  update public.billing_checkouts
  set status = 'paid', provider_payment_id = p_payment_id
  where id = checkout.id;

  insert into public.platform_invoices (
    tenant_id, subscription_id, number, taxable_paise, cgst_paise, sgst_paise, igst_paise,
    total_paise, gst_rate, seller_gstin, buyer_gstin, place_of_supply, provider_payment_id
  ) values (
    checkout.tenant_id,
    sub_id,
    'PF-' || to_char(now() at time zone 'utc', 'YYYY') || '-' || left(checkout.id::text, 8),
    p_taxable_paise, p_cgst_paise, p_sgst_paise, p_igst_paise, p_total_paise,
    18, nullif(p_seller_gstin, ''), buyer, p_place_of_supply, p_payment_id
  );

  return jsonb_build_object('activated', true, 'plan', chosen.code, 'invoice_total_paise', p_total_paise);
end;
$$;

create or replace function public.schedule_platform_plan(p_plan_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tid uuid := public.current_tenant_id();
  row public.tenant_subscriptions;
  free boolean;
begin
  if tid is null or not public.has_admin_access() then
    raise exception 'Owner or admin role is required' using errcode = '42501';
  end if;
  select p.code = 'free' into free from public.plans p where p.id = p_plan_id;
  if free is null then
    raise exception 'Unknown plan' using errcode = 'P0002';
  end if;

  update public.tenant_subscriptions
  set pending_plan_id = p_plan_id,
      cancel_at_period_end = free
  where tenant_id = tid
    and status in ('trialing', 'active', 'past_due', 'paused')
  returning * into row;

  if row.id is null then
    return null;
  end if;
  return jsonb_build_object(
    'id', row.id,
    'pending_plan_id', row.pending_plan_id,
    'current_period_end', row.current_period_end
  );
end;
$$;

create or replace function public.cancel_platform_subscription()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tid uuid := public.current_tenant_id();
  row public.tenant_subscriptions;
begin
  if tid is null or not public.has_admin_access() then
    raise exception 'Owner or admin role is required' using errcode = '42501';
  end if;

  update public.tenant_subscriptions
  set cancel_at_period_end = true
  where tenant_id = tid
    and status in ('trialing', 'active', 'past_due', 'paused')
  returning * into row;

  if row.id is null then
    return null;
  end if;
  return to_jsonb(row);
end;
$$;

create or replace function public.messaging_secret_flags()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  tid uuid := public.current_tenant_id();
  flags jsonb;
begin
  if tid is null or not public.has_admin_access() then
    raise exception 'Owner or admin role is required' using errcode = '42501';
  end if;
  select ms.secrets_flags into flags
  from public.messaging_settings ms
  where ms.tenant_id = tid;
  return coalesce(flags, '{}'::jsonb);
end;
$$;

create or replace function public.messaging_secrets_enc()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  tid uuid := public.current_tenant_id();
  enc text;
begin
  if tid is null or not public.has_admin_access() then
    raise exception 'Owner or admin role is required' using errcode = '42501';
  end if;
  select ms.secrets_enc into enc
  from public.messaging_settings ms
  where ms.tenant_id = tid;
  return enc;
end;
$$;

create or replace function public.save_messaging_settings(
  p_sms_provider text,
  p_email_provider text,
  p_msg91_sender_id text,
  p_msg91_dlt_template_id text,
  p_twilio_from text,
  p_smtp_host text,
  p_smtp_port integer,
  p_smtp_user text,
  p_resend_from text,
  p_secrets_enc text,
  p_secrets_flags jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  tid uuid := public.current_tenant_id();
begin
  if tid is null or not public.has_admin_access() then
    raise exception 'Owner or admin role is required' using errcode = '42501';
  end if;
  if p_sms_provider not in ('none', 'msg91', 'twilio') then
    raise exception 'sms_provider must be none, msg91, or twilio' using errcode = '22023';
  end if;
  if p_email_provider not in ('none', 'smtp', 'resend') then
    raise exception 'email_provider must be none, smtp, or resend' using errcode = '22023';
  end if;

  insert into public.messaging_settings (
    tenant_id, sms_provider, email_provider, msg91_sender_id, msg91_dlt_template_id,
    twilio_from, smtp_host, smtp_port, smtp_user, resend_from,
    secrets, secrets_enc, secrets_flags
  ) values (
    tid, p_sms_provider, p_email_provider, p_msg91_sender_id, p_msg91_dlt_template_id,
    p_twilio_from, p_smtp_host, p_smtp_port, p_smtp_user, p_resend_from,
    '{}'::jsonb, p_secrets_enc, coalesce(p_secrets_flags, '{}'::jsonb)
  )
  on conflict (tenant_id) do update set
    sms_provider = excluded.sms_provider,
    email_provider = excluded.email_provider,
    msg91_sender_id = excluded.msg91_sender_id,
    msg91_dlt_template_id = excluded.msg91_dlt_template_id,
    twilio_from = excluded.twilio_from,
    smtp_host = excluded.smtp_host,
    smtp_port = excluded.smtp_port,
    smtp_user = excluded.smtp_user,
    resend_from = excluded.resend_from,
    secrets = '{}'::jsonb,
    secrets_enc = excluded.secrets_enc,
    secrets_flags = excluded.secrets_flags,
    updated_at = now();
end;
$$;

revoke all on function public.record_billing_checkout(uuid, public.billing_cycle, integer, text, text) from public, anon;
revoke all on function public.activate_platform_checkout(text, text, integer, integer, integer, integer, integer, text, text) from public, anon;
revoke all on function public.schedule_platform_plan(uuid) from public, anon;
revoke all on function public.cancel_platform_subscription() from public, anon;
revoke all on function public.messaging_secret_flags() from public, anon;
revoke all on function public.messaging_secrets_enc() from public, anon;
revoke all on function public.save_messaging_settings(text, text, text, text, text, text, integer, text, text, text, jsonb) from public, anon;

grant execute on function public.record_billing_checkout(uuid, public.billing_cycle, integer, text, text) to authenticated;
grant execute on function public.activate_platform_checkout(text, text, integer, integer, integer, integer, integer, text, text) to authenticated, service_role;
grant execute on function public.schedule_platform_plan(uuid) to authenticated;
grant execute on function public.cancel_platform_subscription() to authenticated;
grant execute on function public.messaging_secret_flags() to authenticated;
grant execute on function public.messaging_secrets_enc() to authenticated;
grant execute on function public.save_messaging_settings(text, text, text, text, text, text, integer, text, text, text, jsonb) to authenticated;

revoke select (secrets_flags) on public.messaging_settings from authenticated, anon;

-- A table-level SELECT still covers columns that were revoked one by one.
-- Grant the public columns only, and let the RPCs write the ciphertext.
revoke select, insert, update on table public.messaging_settings from authenticated, anon;
grant select (
  tenant_id, sms_provider, email_provider, msg91_sender_id, msg91_dlt_template_id,
  twilio_from, smtp_host, smtp_port, smtp_user, resend_from, updated_at
) on public.messaging_settings to authenticated;
grant update (
  sms_provider, email_provider, msg91_sender_id, msg91_dlt_template_id,
  twilio_from, smtp_host, smtp_port, smtp_user, resend_from, updated_at
) on public.messaging_settings to authenticated;
-- Counter sync, morning summary, invoice timeline, ledger links.
-- User-facing RPCs run as the caller (security definer + membership checks).
-- Invoice numbers are assigned by next_invoice_number inside the sync transaction.

alter table public.invoices
  add column if not exists client_id uuid,
  add column if not exists device_id text;

alter table public.payments
  add column if not exists client_id uuid;

alter table public.invoice_items
  add column if not exists product_id uuid references public.products (id) on delete set null;

alter table public.products
  add column if not exists is_favourite boolean not null default false,
  add column if not exists reorder_level numeric(12, 3) not null default 5;

alter table public.tenants
  add column if not exists locale text not null default 'en';

alter table public.tenants drop constraint if exists tenants_locale_known;
alter table public.tenants
  add constraint tenants_locale_known check (locale in ('en', 'bn'));

create unique index if not exists invoices_client_id_idx
  on public.invoices (tenant_id, client_id) where client_id is not null;

create unique index if not exists payments_client_id_idx
  on public.payments (tenant_id, client_id) where client_id is not null;

create table if not exists public.invoice_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  kind text not null check (kind in (
    'created', 'sent', 'viewed', 'reminder_sent', 'payment_received', 'voided', 'synced'
  )),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists invoice_events_invoice_idx
  on public.invoice_events (invoice_id, created_at);

create unique index if not exists invoice_events_viewed_day
  on public.invoice_events (invoice_id, ((created_at at time zone 'Asia/Kolkata')::date))
  where kind = 'viewed';

create table if not exists public.customer_ledger_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  token text not null unique,
  revoked_at timestamptz,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint customer_ledger_token_len check (char_length(token) >= 24)
);

create index if not exists customer_ledger_customer_idx
  on public.customer_ledger_links (customer_id, created_at desc);

create or replace function public.record_invoice_event(
  p_invoice uuid,
  p_kind text,
  p_metadata jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  tid uuid;
begin
  select tenant_id into tid from public.invoices where id = p_invoice;
  if tid is null then
    return;
  end if;
  insert into public.invoice_events (tenant_id, invoice_id, kind, metadata)
  values (tid, p_invoice, p_kind, coalesce(p_metadata, '{}'::jsonb));
exception
  when unique_violation then
    null;
end;
$$;

create or replace function public.log_invoice_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.record_invoice_event(new.id, 'created', '{}'::jsonb);
  return new;
end;
$$;

drop trigger if exists invoices_log_created on public.invoices;
create trigger invoices_log_created
  after insert on public.invoices
  for each row execute function public.log_invoice_created();

create or replace function public.log_invoice_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status and new.status = 'sent' then
    perform public.record_invoice_event(new.id, 'sent', '{}'::jsonb);
  elsif new.status is distinct from old.status and new.status = 'void' then
    perform public.record_invoice_event(new.id, 'voided', '{}'::jsonb);
  end if;
  return new;
end;
$$;

drop trigger if exists invoices_log_status on public.invoices;
create trigger invoices_log_status
  after update of status on public.invoices
  for each row execute function public.log_invoice_status();

create or replace function public.log_payment_received()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'succeeded' and (tg_op = 'INSERT' or old.status is distinct from 'succeeded') then
    perform public.record_invoice_event(new.invoice_id, 'payment_received', jsonb_build_object(
      'payment_id', new.id, 'amount', new.amount, 'method', new.method
    ));
  end if;
  return new;
end;
$$;

drop trigger if exists payments_log_received on public.payments;
create trigger payments_log_received
  after insert or update of status on public.payments
  for each row execute function public.log_payment_received();

create or replace function public.log_reminder_sent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'sent' and (tg_op = 'INSERT' or old.status is distinct from 'sent') then
    perform public.record_invoice_event(new.invoice_id, 'reminder_sent', jsonb_build_object(
      'channel', new.channel, 'job_id', new.id
    ));
  end if;
  return new;
end;
$$;

drop trigger if exists reminder_jobs_log_sent on public.reminder_jobs;
create trigger reminder_jobs_log_sent
  after insert or update of status on public.reminder_jobs
  for each row execute function public.log_reminder_sent();

create or replace function public.record_share_view(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  share public.invoice_shares;
begin
  select * into share from public.invoice_shares s
  where s.token = p_token and s.revoked_at is null and s.expires_at > now();
  if not found then
    return;
  end if;
  perform public.record_invoice_event(share.invoice_id, 'viewed', jsonb_build_object('token_id', share.id));
end;
$$;

create or replace function public.sync_offline_sales(p_sales jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tid uuid := public.current_tenant_id();
  sale jsonb;
  line jsonb;
  pay jsonb;
  results jsonb := '[]'::jsonb;
  existing public.invoices;
  inv_id uuid;
  customer uuid;
  walk_in uuid;
  pay_id uuid;
  method public.payment_method;
  created_new boolean;
  assigned_number text;
begin
  if tid is null or not public.has_billing_access() then
    raise exception 'billing access is required' using errcode = '42501';
  end if;
  if p_sales is null or jsonb_typeof(p_sales) <> 'array' then
    raise exception 'sales must be an array' using errcode = '22023';
  end if;

  for sale in select value from jsonb_array_elements(p_sales)
  loop
    begin
      if (sale ->> 'client_id') is null then
        raise exception 'client_id is required' using errcode = '22023';
      end if;

      select * into existing
      from public.invoices
      where tenant_id = tid and client_id = (sale ->> 'client_id')::uuid;

      if existing.id is not null and existing.status = 'void' then
        results := results || jsonb_build_array(jsonb_build_object(
          'client_id', sale ->> 'client_id',
          'status', 'conflict',
          'reason', 'voided',
          'invoice_id', existing.id,
          'number', existing.number
        ));
        continue;
      end if;

      created_new := existing.id is null;
      if created_new then
        customer := nullif(sale ->> 'customer_id', '')::uuid;
        if customer is null then
          select c.id into walk_in from public.customers c
          where c.tenant_id = tid and c.name = 'Walk-in'
          limit 1;
          if walk_in is null then
            insert into public.customers (tenant_id, name)
            values (tid, 'Walk-in')
            returning id into walk_in;
          end if;
          customer := walk_in;
        end if;

        insert into public.invoices (
          tenant_id, customer_id, number, status, source, client_id, device_id, notes, currency
        ) values (
          tid, customer, '', 'draft', 'billing',
          (sale ->> 'client_id')::uuid,
          nullif(sale ->> 'device_id', ''),
          nullif(sale ->> 'notes', ''),
          'INR'
        )
        returning id into inv_id;

        for line in select value from jsonb_array_elements(coalesce(sale -> 'lines', '[]'::jsonb))
        loop
          insert into public.invoice_items (
            tenant_id, invoice_id, product_id, description, quantity, unit_price, tax_rate, unit, discount
          ) values (
            tid,
            inv_id,
            nullif(line ->> 'product_id', '')::uuid,
            coalesce(nullif(line ->> 'description', ''), 'Item'),
            coalesce((line ->> 'quantity')::numeric, 1),
            coalesce((line ->> 'unit_price')::numeric, 0),
            coalesce((line ->> 'gst_rate')::numeric, 0),
            coalesce(nullif(line ->> 'unit', ''), 'NOS'),
            coalesce((line ->> 'discount')::numeric, 0)
          );
        end loop;

        update public.invoices set status = 'sent' where id = inv_id and status = 'draft';
        perform public.record_invoice_event(inv_id, 'synced', jsonb_build_object('device_id', sale ->> 'device_id'));
      else
        inv_id := existing.id;
      end if;

      for pay in select value from jsonb_array_elements(coalesce(sale -> 'payments', '[]'::jsonb))
      loop
        if (pay ->> 'client_id') is not null and exists (
          select 1 from public.payments p
          where p.tenant_id = tid and p.client_id = (pay ->> 'client_id')::uuid
        ) then
          continue;
        end if;
        method := coalesce(nullif(pay ->> 'method', ''), 'cash')::public.payment_method;
        insert into public.payments (
          tenant_id, invoice_id, client_id, amount, method, status,
          amount_tendered, change_given, paid_at, transaction_ref, recorded_by
        ) values (
          tid,
          inv_id,
          nullif(pay ->> 'client_id', '')::uuid,
          (pay ->> 'amount')::numeric,
          method,
          'succeeded',
          nullif(pay ->> 'amount_tendered', '')::numeric,
          nullif(pay ->> 'change_given', '')::numeric,
          coalesce(nullif(pay ->> 'paid_at', '')::timestamptz, now()),
          nullif(pay ->> 'transaction_ref', ''),
          auth.uid()
        )
        returning id into pay_id;
      end loop;

      select i.number into assigned_number from public.invoices i where i.id = inv_id;
      results := results || jsonb_build_array(jsonb_build_object(
        'client_id', sale ->> 'client_id',
        'status', case when created_new then 'created' else 'exists' end,
        'invoice_id', inv_id,
        'number', assigned_number
      ));
    exception
      when others then
        results := results || jsonb_build_array(jsonb_build_object(
          'client_id', sale ->> 'client_id',
          'status', 'conflict',
          'reason', sqlerrm
        ));
    end;
  end loop;

  return results;
end;
$$;

create or replace function public.pos_tiles()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  tid uuid := public.current_tenant_id();
  favourites jsonb;
  top_sellers jsonb;
begin
  if tid is null then
    raise exception 'no active tenant' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row_to_json(f) order by f.name), '[]'::jsonb)
    into favourites
  from (
    select p.id, p.name, p.unit, p.price, p.gst_rate, p.stock, true as favourite
    from public.products p
    where p.tenant_id = tid and p.active and p.is_favourite
    order by p.name
    limit 24
  ) f;

  select coalesce(jsonb_agg(row_to_json(s) order by s.sold_qty desc), '[]'::jsonb)
    into top_sellers
  from (
    select
      it.description as name,
      sum(it.quantity) as sold_qty,
      (
        select pr.id from public.products pr
        where pr.tenant_id = tid and lower(pr.name) = lower(it.description)
        limit 1
      ) as product_id
    from public.invoice_items it
    join public.invoices i on i.id = it.invoice_id
    where i.tenant_id = tid
      and i.status <> 'void'
      and i.created_at > now() - interval '30 days'
    group by it.description
    order by sold_qty desc
    limit 12
  ) s;

  return jsonb_build_object('favourites', favourites, 'top_sellers', top_sellers);
end;
$$;

create or replace function public.morning_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  tid uuid := public.current_tenant_id();
  today date := (now() at time zone 'Asia/Kolkata')::date;
  yesterday date := today - 1;
  sales numeric;
  invoice_count integer;
  dues jsonb;
  low_stock jsonb;
  series7 jsonb;
  series30 jsonb;
begin
  if tid is null then
    raise exception 'no active tenant' using errcode = '42501';
  end if;

  select coalesce(sum(i.total), 0), count(*)
    into sales, invoice_count
  from public.invoices i
  where i.tenant_id = tid
    and i.status <> 'void'
    and (i.created_at at time zone 'Asia/Kolkata')::date = yesterday;

  select coalesce(jsonb_agg(row_to_json(d) order by d.balance desc), '[]'::jsonb)
    into dues
  from (
    select c.id as customer_id, c.name, b.balance
    from public.customers c
    join lateral (
      select greatest(0,
        coalesce((select sum(i.total) from public.invoices i where i.customer_id = c.id and i.tenant_id = tid and i.status <> 'void'), 0)
        - coalesce((
          select sum(p.amount) from public.payments p
          join public.invoices i on i.id = p.invoice_id
          where i.customer_id = c.id and i.tenant_id = tid and i.status <> 'void' and p.status = 'succeeded'
        ), 0)
      ) as balance
    ) b on true
    where c.tenant_id = tid and b.balance > 0
    order by b.balance desc
    limit 5
  ) d;

  select coalesce(jsonb_agg(row_to_json(s) order by s.stock), '[]'::jsonb)
    into low_stock
  from (
    select p.id as product_id, p.name, p.stock
    from public.products p
    where p.tenant_id = tid and p.active and p.stock is not null and p.stock <= p.reorder_level
    order by p.stock
    limit 8
  ) s;

  select coalesce(jsonb_agg(jsonb_build_object('date', day::text, 'sales', coalesce(v.sales, 0)) order by day), '[]'::jsonb)
    into series7
  from generate_series(today - 6, today, interval '1 day') as day
  left join (
    select (i.created_at at time zone 'Asia/Kolkata')::date as sold_on, sum(i.total) as sales
    from public.invoices i
    where i.tenant_id = tid and i.status <> 'void'
      and (i.created_at at time zone 'Asia/Kolkata')::date >= today - 6
    group by 1
  ) v on v.sold_on = day::date;

  select coalesce(jsonb_agg(jsonb_build_object('date', day::text, 'sales', coalesce(v.sales, 0)) order by day), '[]'::jsonb)
    into series30
  from generate_series(today - 29, today, interval '1 day') as day
  left join (
    select (i.created_at at time zone 'Asia/Kolkata')::date as sold_on, sum(i.total) as sales
    from public.invoices i
    where i.tenant_id = tid and i.status <> 'void'
      and (i.created_at at time zone 'Asia/Kolkata')::date >= today - 29
    group by 1
  ) v on v.sold_on = day::date;

  return jsonb_build_object(
    'yesterday', jsonb_build_object('sales', sales, 'invoice_count', invoice_count),
    'top_dues', dues,
    'low_stock', low_stock,
    'series_7d', series7,
    'series_30d', series30
  );
end;
$$;

create or replace function public.create_customer_ledger_link(p_customer uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tid uuid := public.current_tenant_id();
  token text := encode(gen_random_bytes(24), 'hex');
  row public.customer_ledger_links;
begin
  if tid is null or not public.has_billing_access() then
    raise exception 'billing access is required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.customers c where c.id = p_customer and c.tenant_id = tid) then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;

  update public.customer_ledger_links
  set revoked_at = now()
  where customer_id = p_customer and revoked_at is null;

  insert into public.customer_ledger_links (tenant_id, customer_id, token, created_by)
  values (tid, p_customer, token, auth.uid())
  returning * into row;

  return jsonb_build_object(
    'token', row.token,
    'customer_id', row.customer_id,
    'created_at', row.created_at,
    'revoked_at', null
  );
end;
$$;

create or replace function public.revoke_customer_ledger_link(p_customer uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tid uuid := public.current_tenant_id();
  n integer;
begin
  if tid is null or not public.has_billing_access() then
    raise exception 'billing access is required' using errcode = '42501';
  end if;
  update public.customer_ledger_links
  set revoked_at = now()
  where customer_id = p_customer and tenant_id = tid and revoked_at is null;
  get diagnostics n = row_count;
  return jsonb_build_object('revoked', n);
end;
$$;

create or replace function public.get_customer_ledger(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  link public.customer_ledger_links;
  shop public.tenants;
  buyer public.customers;
  invoices jsonb;
  payments jsonb;
  balance numeric;
  razorpay_on boolean;
begin
  select * into link from public.customer_ledger_links
  where token = p_token and revoked_at is null;
  if not found then
    return null;
  end if;
  select * into shop from public.tenants where id = link.tenant_id;
  select * into buyer from public.customers where id = link.customer_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id, 'number', i.number, 'status', i.status, 'total', i.total,
    'issued_at', i.issued_at, 'due_at', i.due_at, 'created_at', i.created_at
  ) order by i.created_at), '[]'::jsonb)
    into invoices
  from public.invoices i
  where i.customer_id = buyer.id and i.tenant_id = shop.id and i.status <> 'void';

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'invoice_id', p.invoice_id, 'amount', p.amount, 'method', p.method,
    'status', p.status, 'paid_at', p.paid_at
  ) order by p.paid_at), '[]'::jsonb)
    into payments
  from public.payments p
  join public.invoices i on i.id = p.invoice_id
  where i.customer_id = buyer.id and i.tenant_id = shop.id and p.status = 'succeeded';

  select greatest(0,
    coalesce((select sum(i.total) from public.invoices i where i.customer_id = buyer.id and i.status <> 'void'), 0)
    - coalesce((
      select sum(p.amount) from public.payments p
      join public.invoices i on i.id = p.invoice_id
      where i.customer_id = buyer.id and p.status = 'succeeded' and i.status <> 'void'
    ), 0)
  ) into balance;

  select exists (
    select 1 from public.tenant_razorpay r
    where r.tenant_id = shop.id and r.enabled and r.key_id is not null
  ) into razorpay_on;

  return jsonb_build_object(
    'shop', jsonb_build_object(
      'name', coalesce(shop.legal_name, shop.name),
      'locale', shop.locale,
      'upi_vpa', shop.upi_vpa,
      'upi_payee_name', coalesce(shop.upi_payee_name, shop.legal_name, shop.name)
    ),
    'customer', jsonb_build_object('id', buyer.id, 'name', buyer.name),
    'invoices', invoices,
    'payments', payments,
    'balance', balance,
    'razorpay_available', razorpay_on
  );
end;
$$;

alter table public.invoice_events enable row level security;
alter table public.customer_ledger_links enable row level security;

drop policy if exists invoice_events_select on public.invoice_events;
create policy invoice_events_select on public.invoice_events
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists customer_ledger_select on public.customer_ledger_links;
create policy customer_ledger_select on public.customer_ledger_links
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

grant select on public.invoice_events to authenticated;
grant select on public.customer_ledger_links to authenticated;
grant all privileges on public.invoice_events, public.customer_ledger_links to service_role;

revoke all on function public.record_invoice_event(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.sync_offline_sales(jsonb) from public, anon;
revoke all on function public.pos_tiles() from public, anon;
revoke all on function public.morning_summary() from public, anon;
revoke all on function public.create_customer_ledger_link(uuid) from public, anon;
revoke all on function public.revoke_customer_ledger_link(uuid) from public, anon;
revoke all on function public.get_customer_ledger(text) from public;
revoke all on function public.record_share_view(text) from public;

grant execute on function public.sync_offline_sales(jsonb) to authenticated;
grant execute on function public.pos_tiles() to authenticated;
grant execute on function public.morning_summary() to authenticated;
grant execute on function public.create_customer_ledger_link(uuid) to authenticated;
grant execute on function public.revoke_customer_ledger_link(uuid) to authenticated;
grant execute on function public.get_customer_ledger(text) to anon, authenticated;
grant execute on function public.record_share_view(text) to anon, authenticated;
grant execute on function public.record_invoice_event(uuid, text, jsonb) to service_role;
-- Hosted Supabase installs pgcrypto in the extensions schema.
-- create_customer_ledger_link set search_path = public, so gen_random_bytes was missing.

create schema if not exists extensions;

do $$
begin
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'extensions'
      and p.proname = 'gen_random_bytes'
  ) then
    execute $fn$
      create function extensions.gen_random_bytes(integer)
      returns bytea
      language sql
      stable
      as $body$ select public.gen_random_bytes($1) $body$
    $fn$;
  end if;
end $$;

create or replace function public.create_customer_ledger_link(p_customer uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  tid uuid := public.current_tenant_id();
  token text := encode(extensions.gen_random_bytes(24), 'hex');
  row public.customer_ledger_links;
begin
  if tid is null or not public.has_billing_access() then
    raise exception 'billing access is required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.customers c where c.id = p_customer and c.tenant_id = tid) then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;

  update public.customer_ledger_links
  set revoked_at = now()
  where customer_id = p_customer and revoked_at is null;

  insert into public.customer_ledger_links (tenant_id, customer_id, token, created_by)
  values (tid, p_customer, token, auth.uid())
  returning * into row;

  return jsonb_build_object(
    'token', row.token,
    'customer_id', row.customer_id,
    'created_at', row.created_at,
    'revoked_at', null
  );
end;
$$;

revoke all on function public.create_customer_ledger_link(uuid) from public, anon;
grant execute on function public.create_customer_ledger_link(uuid) to authenticated;
-- Supplier purchases and shop categories for the counter tiles.
-- Stock moves only when the tenant has stock_tracking.

create table if not exists public.product_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name),
  constraint product_categories_name_len check (char_length(btrim(name)) >= 1)
);

alter table public.products
  add column if not exists category_id uuid references public.product_categories (id) on delete set null;

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  supplier text,
  bill_date date,
  photo_ref text,
  notes text,
  taxable numeric(12, 2) not null default 0 check (taxable >= 0),
  tax numeric(12, 2) not null default 0 check (tax >= 0),
  total numeric(12, 2) not null default 0 check (total >= 0),
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists purchases_tenant_idx on public.purchases (tenant_id, bill_date desc);

create table if not exists public.purchase_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  purchase_id uuid not null references public.purchases (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  description text not null,
  quantity numeric(12, 3) not null check (quantity > 0),
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  gst_rate numeric(6, 3) not null default 0 check (gst_rate >= 0 and gst_rate <= 100),
  tax_amount numeric(12, 2) not null default 0 check (tax_amount >= 0),
  line_total numeric(12, 2) not null default 0 check (line_total >= 0),
  sort_order integer not null default 0,
  constraint purchase_lines_description_len check (char_length(btrim(description)) >= 1)
);

create index if not exists purchase_lines_purchase_idx on public.purchase_lines (purchase_id, sort_order);

create or replace function public.save_purchase(p_body jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tid uuid := public.current_tenant_id();
  purchase_id uuid;
  line jsonb;
  idx integer := 0;
  qty numeric;
  price numeric;
  rate numeric;
  taxable numeric;
  tax numeric;
  line_taxable numeric := 0;
  line_tax numeric := 0;
  track boolean;
begin
  if tid is null or not public.has_billing_access() then
    raise exception 'billing access is required' using errcode = '42501';
  end if;
  if p_body -> 'lines' is null or jsonb_typeof(p_body -> 'lines') <> 'array' or jsonb_array_length(p_body -> 'lines') = 0 then
    raise exception 'at least one line is required' using errcode = '22023';
  end if;

  insert into public.purchases (tenant_id, supplier, bill_date, photo_ref, notes, created_by)
  values (
    tid,
    nullif(btrim(coalesce(p_body ->> 'supplier', '')), ''),
    nullif(p_body ->> 'bill_date', '')::date,
    nullif(btrim(coalesce(p_body ->> 'photo_ref', '')), ''),
    nullif(btrim(coalesce(p_body ->> 'notes', '')), ''),
    auth.uid()
  )
  returning id into purchase_id;

  track := public.has_feature(tid, 'stock_tracking');

  for line in select value from jsonb_array_elements(p_body -> 'lines')
  loop
    idx := idx + 1;
    qty := coalesce((line ->> 'quantity')::numeric, 0);
    price := coalesce((line ->> 'unit_price')::numeric, 0);
    rate := coalesce((line ->> 'gst_rate')::numeric, nullif(p_body ->> 'gst_rate', '')::numeric, 0);
    taxable := round(qty * price, 2);
    tax := round(taxable * rate / 100.0, 2);
    line_taxable := line_taxable + taxable;
    line_tax := line_tax + tax;
    insert into public.purchase_lines (
      tenant_id, purchase_id, product_id, description, quantity, unit_price, gst_rate, tax_amount, line_total, sort_order
    ) values (
      tid,
      purchase_id,
      nullif(line ->> 'product_id', '')::uuid,
      coalesce(nullif(btrim(coalesce(line ->> 'description', '')), ''), 'Item'),
      qty,
      price,
      rate,
      tax,
      taxable + tax,
      idx
    );
    if track and nullif(line ->> 'product_id', '') is not null then
      update public.products
      set stock = stock + qty
      where id = (line ->> 'product_id')::uuid
        and tenant_id = tid
        and stock is not null;
    end if;
  end loop;

  update public.purchases
  set taxable = line_taxable,
      tax = line_tax,
      total = line_taxable + line_tax
  where id = purchase_id;

  return (
    select jsonb_build_object(
      'id', p.id,
      'supplier', p.supplier,
      'bill_date', p.bill_date,
      'photo_ref', p.photo_ref,
      'notes', p.notes,
      'taxable', p.taxable,
      'tax', p.tax,
      'total', p.total,
      'created_at', p.created_at,
      'lines', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', l.id,
          'product_id', l.product_id,
          'description', l.description,
          'quantity', l.quantity,
          'unit_price', l.unit_price,
          'gst_rate', l.gst_rate,
          'tax_amount', l.tax_amount,
          'line_total', l.line_total
        ) order by l.sort_order)
        from public.purchase_lines l
        where l.purchase_id = p.id
      ), '[]'::jsonb)
    )
    from public.purchases p
    where p.id = purchase_id
  );
end;
$$;

drop function if exists public.pos_tiles();

create or replace function public.pos_tiles(p_category uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  tid uuid := public.current_tenant_id();
  favourites jsonb;
  top_sellers jsonb;
  categories jsonb;
  uncategorized jsonb;
begin
  if tid is null then
    raise exception 'no active tenant' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'name', p.name, 'unit', p.unit, 'price', p.price,
    'gst_rate', p.gst_rate, 'stock', p.stock, 'favourite', true, 'category_id', p.category_id
  ) order by p.name), '[]'::jsonb)
    into favourites
  from public.products p
  where p.tenant_id = tid and p.active and p.is_favourite
    and (p_category is null or p.category_id = p_category);

  select coalesce(jsonb_agg(jsonb_build_object(
    'name', s.name, 'sold_qty', s.sold_qty, 'product_id', s.product_id, 'category_id', s.category_id
  ) order by s.sold_qty desc), '[]'::jsonb)
    into top_sellers
  from (
    select
      it.description as name,
      sum(it.quantity) as sold_qty,
      (
        select pr.id from public.products pr
        where pr.tenant_id = tid
          and (pr.id = it.product_id or (it.product_id is null and lower(pr.name) = lower(it.description)))
        limit 1
      ) as product_id,
      (
        select pr.category_id from public.products pr
        where pr.tenant_id = tid
          and (pr.id = it.product_id or (it.product_id is null and lower(pr.name) = lower(it.description)))
        limit 1
      ) as category_id
    from public.invoice_items it
    join public.invoices i on i.id = it.invoice_id
    where i.tenant_id = tid
      and i.status <> 'void'
      and i.created_at > now() - interval '30 days'
    group by it.description, it.product_id
    order by sold_qty desc
    limit 12
  ) s
  where p_category is null or s.category_id = p_category;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'sort_order', c.sort_order,
    'tiles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'unit', p.unit, 'price', p.price,
        'gst_rate', p.gst_rate, 'stock', p.stock, 'favourite', p.is_favourite, 'category_id', p.category_id
      ) order by p.name)
      from public.products p
      where p.category_id = c.id and p.tenant_id = tid and p.active
    ), '[]'::jsonb)
  ) order by c.sort_order, c.name), '[]'::jsonb)
    into categories
  from public.product_categories c
  where c.tenant_id = tid
    and (p_category is null or c.id = p_category);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'name', p.name, 'unit', p.unit, 'price', p.price,
    'gst_rate', p.gst_rate, 'stock', p.stock, 'favourite', p.is_favourite, 'category_id', null
  ) order by p.name), '[]'::jsonb)
    into uncategorized
  from public.products p
  where p.tenant_id = tid and p.active and p.category_id is null
    and p_category is null;

  return jsonb_build_object(
    'favourites', favourites,
    'top_sellers', top_sellers,
    'categories', categories,
    'uncategorized', uncategorized
  );
end;
$$;

alter table public.product_categories enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_lines enable row level security;

drop policy if exists product_categories_select on public.product_categories;
create policy product_categories_select on public.product_categories
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists product_categories_write on public.product_categories;
create policy product_categories_write on public.product_categories
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_billing_access())
  with check (tenant_id = public.current_tenant_id() and public.has_billing_access());

drop policy if exists purchases_select on public.purchases;
create policy purchases_select on public.purchases
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists purchase_lines_select on public.purchase_lines;
create policy purchase_lines_select on public.purchase_lines
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

grant select, insert, update, delete on public.product_categories to authenticated;
grant select on public.purchases, public.purchase_lines to authenticated;
grant all privileges on public.product_categories, public.purchases, public.purchase_lines to service_role;

revoke all on function public.save_purchase(jsonb) from public, anon;
revoke all on function public.pos_tiles(uuid) from public, anon;
grant execute on function public.save_purchase(jsonb) to authenticated;
grant execute on function public.pos_tiles(uuid) to authenticated;
-- Platform admin, invoice template keys, and branding columns.
-- Storefront templates stay in public.templates. Invoice layouts are invoice_templates.

create table if not exists public.platform_admins (
  user_id uuid primary key references public.users (id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.invoice_templates (
  key text primary key,
  name text not null,
  description text not null default '',
  required_feature text,
  active boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_templates_key_format check (key ~ '^[a-z0-9_]+$')
);

insert into public.invoice_templates (key, name, description, required_feature, config) values
  ('classic', 'Classic', 'A plain A4 bill.', null, '{"page":"a4"}'::jsonb),
  ('modern', 'Modern', 'An accent bar and a quiet header.', 'custom_templates', '{"page":"a4"}'::jsonb),
  ('minimal', 'Minimal', 'Small type and few rules.', 'custom_templates', '{"page":"a4"}'::jsonb),
  ('bold', 'Bold', 'A large total.', 'custom_templates', '{"page":"a4"}'::jsonb),
  ('thermal_58', 'Thermal 58mm', 'A narrow receipt.', 'custom_templates', '{"page":"58"}'::jsonb),
  ('thermal_80', 'Thermal 80mm', 'A counter receipt.', 'custom_templates', '{"page":"80"}'::jsonb),
  ('bengali', 'Bengali', 'Classic layout with a Bengali font.', 'custom_templates', '{"page":"a4","font":"bengali"}'::jsonb)
on conflict (key) do update
  set name = excluded.name,
      description = excluded.description,
      required_feature = excluded.required_feature;

alter table public.tenants
  add column if not exists default_template text not null default 'classic';

alter table public.invoices
  add column if not exists template_key text,
  add column if not exists pdf_url text;

alter table public.users
  add column if not exists avatar_url text;

alter table public.audit_logs alter column tenant_id drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tenants_default_template_fkey'
  ) then
    alter table public.tenants
      add constraint tenants_default_template_fkey
      foreign key (default_template) references public.invoice_templates (key);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'invoices_template_key_fkey'
  ) then
    alter table public.invoices
      add constraint invoices_template_key_fkey
      foreign key (template_key) references public.invoice_templates (key);
  end if;
end $$;

create or replace function public.claim_platform_admin_for(p_user uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  found_email text;
begin
  select lower(u.email) into found_email from auth.users u where u.id = p_user;
  if found_email = 'maheshpatra920@gmail.com' then
    insert into public.platform_admins (user_id, email)
    values (p_user, found_email)
    on conflict (user_id) do update set email = excluded.email;
  end if;
  return exists (select 1 from public.platform_admins a where a.user_id = p_user);
end;
$$;

create or replace function public.claim_platform_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select public.claim_platform_admin_for(auth.uid());
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.platform_admins a where a.user_id = auth.uid());
$$;

insert into public.platform_admins (user_id, email)
select u.id, lower(u.email)
from auth.users u
where lower(u.email) = 'maheshpatra920@gmail.com'
on conflict (user_id) do update set email = excluded.email;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.invitations;
begin
  insert into public.users (id, email, name)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'name',
      new.raw_user_meta_data ->> 'full_name',
      split_part(coalesce(new.email, 'user'), '@', 1)
    )
  )
  on conflict (id) do update
    set email = excluded.email,
        name = coalesce(public.users.name, excluded.name);

  if new.email is not null then
    for inv in
      select *
      from public.invitations i
      where lower(i.email) = lower(new.email)
        and i.status = 'pending'
        and i.expires_at > now()
    loop
      insert into public.memberships (tenant_id, user_id, role, status)
      values (inv.tenant_id, new.id, inv.role, 'active')
      on conflict (tenant_id, user_id) do update
        set role = excluded.role,
            status = 'active';
      update public.invitations
         set status = 'accepted'
       where id = inv.id;
    end loop;
  end if;

  perform public.claim_platform_admin_for(new.id);
  return new;
end;
$$;

create or replace function public.platform_audit(
  p_action text,
  p_entity text,
  p_entity_id uuid,
  p_tenant uuid,
  p_metadata jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_tenant, auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_metadata, '{}'::jsonb));
end;
$$;

create or replace function public.assert_platform_admin()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'platform admin required' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.admin_update_plan(p_code text, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.plans;
begin
  perform public.assert_platform_admin();
  update public.plans
  set name = coalesce(p_patch ->> 'name', name),
      description = coalesce(p_patch ->> 'description', description),
      price_monthly = coalesce((p_patch ->> 'price_monthly')::numeric, price_monthly),
      price_yearly = coalesce((p_patch ->> 'price_yearly')::numeric, price_yearly),
      price_monthly_paise = coalesce((p_patch ->> 'price_monthly_paise')::integer, price_monthly_paise),
      price_yearly_paise = coalesce((p_patch ->> 'price_yearly_paise')::integer, price_yearly_paise),
      active = coalesce((p_patch ->> 'active')::boolean, active),
      is_public = coalesce((p_patch ->> 'is_public')::boolean, is_public),
      sort_order = coalesce((p_patch ->> 'sort_order')::integer, sort_order)
  where code = p_code
  returning * into row;
  if row.id is null then
    raise exception 'plan not found' using errcode = 'P0002';
  end if;
  perform public.platform_audit('plan.update', 'plan', row.id, null, p_patch);
  return to_jsonb(row);
end;
$$;

create or replace function public.admin_replace_plan_features(p_code text, p_features jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  plan uuid;
  item jsonb;
begin
  perform public.assert_platform_admin();
  select id into plan from public.plans where code = p_code;
  if plan is null then
    raise exception 'plan not found' using errcode = 'P0002';
  end if;
  if p_features is null or jsonb_typeof(p_features) <> 'array' then
    raise exception 'features must be an array' using errcode = '22023';
  end if;
  for item in select value from jsonb_array_elements(p_features)
  loop
    insert into public.plan_features (plan_id, feature_key, enabled, limit_value)
    values (
      plan,
      item ->> 'feature_key',
      coalesce((item ->> 'enabled')::boolean, false),
      nullif(item ->> 'limit_value', '')::integer
    )
    on conflict (plan_id, feature_key) do update
      set enabled = excluded.enabled,
          limit_value = excluded.limit_value;
  end loop;
  perform public.platform_audit('plan.features', 'plan', plan, null, jsonb_build_object('code', p_code, 'features', p_features));
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'feature_key', pf.feature_key, 'enabled', pf.enabled, 'limit_value', pf.limit_value
    ) order by pf.feature_key), '[]'::jsonb)
    from public.plan_features pf
    where pf.plan_id = plan
  );
end;
$$;

create or replace function public.admin_upsert_invoice_template(p_key text, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.invoice_templates;
begin
  perform public.assert_platform_admin();
  insert into public.invoice_templates (key, name, description, required_feature, active, config)
  values (
    p_key,
    coalesce(p_patch ->> 'name', p_key),
    coalesce(p_patch ->> 'description', ''),
    nullif(p_patch ->> 'required_feature', ''),
    coalesce((p_patch ->> 'active')::boolean, true),
    coalesce(p_patch -> 'config', '{}'::jsonb)
  )
  on conflict (key) do update
    set name = coalesce(p_patch ->> 'name', invoice_templates.name),
        description = coalesce(p_patch ->> 'description', invoice_templates.description),
        required_feature = case
          when p_patch ? 'required_feature' then nullif(p_patch ->> 'required_feature', '')
          else invoice_templates.required_feature
        end,
        active = coalesce((p_patch ->> 'active')::boolean, invoice_templates.active),
        config = coalesce(p_patch -> 'config', invoice_templates.config),
        updated_at = now()
  returning * into row;
  perform public.platform_audit('template.upsert', 'invoice_template', null, null, jsonb_build_object('key', p_key));
  return to_jsonb(row);
end;
$$;

create or replace function public.admin_set_tenant_status(p_tenant uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_platform_admin();
  if p_status not in ('active', 'suspended') then
    raise exception 'status must be active or suspended' using errcode = '22023';
  end if;
  update public.tenants set status = p_status::public.tenant_status where id = p_tenant;
  if not found then
    raise exception 'tenant not found' using errcode = 'P0002';
  end if;
  perform public.platform_audit('tenant.status', 'tenant', p_tenant, p_tenant, jsonb_build_object('status', p_status));
  return jsonb_build_object('id', p_tenant, 'status', p_status);
end;
$$;

create or replace function public.admin_set_tenant_plan(p_tenant uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pid uuid;
  price integer;
  updated integer;
begin
  perform public.assert_platform_admin();
  select id, price_monthly_paise into pid, price from public.plans where code = p_code and active;
  if pid is null then
    raise exception 'plan not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.tenants where id = p_tenant) then
    raise exception 'tenant not found' using errcode = 'P0002';
  end if;
  update public.tenant_subscriptions
  set plan_id = pid,
      pending_plan_id = null,
      price_paise = coalesce(price, 0),
      cancel_at_period_end = false
  where tenant_id = p_tenant
    and status in ('trialing', 'active', 'past_due', 'paused');
  get diagnostics updated = row_count;
  if updated = 0 then
    insert into public.tenant_subscriptions (
      tenant_id, plan_id, status, billing_cycle, current_period_start, current_period_end, price_paise
    ) values (
      p_tenant, pid, 'active', 'monthly', current_date, current_date + 30, coalesce(price, 0)
    );
  end if;
  update public.tenants set plan = p_code where id = p_tenant;
  perform public.platform_audit('tenant.plan', 'tenant', p_tenant, p_tenant, jsonb_build_object('plan', p_code));
  return jsonb_build_object('id', p_tenant, 'plan', p_code);
end;
$$;

create or replace function public.admin_update_settings(p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.platform_settings;
begin
  perform public.assert_platform_admin();
  update public.platform_settings
  set app_domain = coalesce(p_patch ->> 'app_domain', app_domain),
      dashboard_host = coalesce(p_patch ->> 'dashboard_host', dashboard_host)
  where id = 1
  returning * into row;
  perform public.platform_audit('settings.update', 'platform_settings', null, null, p_patch);
  return to_jsonb(row);
end;
$$;

create or replace function public.invoice_template_allowed(p_tenant uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.invoice_templates t
    where t.key = p_key
      and t.active
      and (t.required_feature is null or public.has_feature(p_tenant, t.required_feature))
  );
$$;

create or replace function public.list_invoice_templates()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  tid uuid := public.current_tenant_id();
begin
  if tid is null then
    raise exception 'no active tenant' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'key', t.key,
      'name', t.name,
      'description', t.description,
      'required_feature', t.required_feature,
      'required_plan', case when t.required_feature = 'custom_templates' then 'business' else null end,
      'entitled', t.required_feature is null or public.has_feature(tid, t.required_feature),
      'active', t.active
    ) order by t.key)
    from public.invoice_templates t
    where t.active
  ), '[]'::jsonb);
end;
$$;

create or replace function public.enforce_invoice_template()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  chosen text;
begin
  chosen := coalesce(new.template_key, (select default_template from public.tenants where id = new.tenant_id), 'classic');
  if not public.invoice_template_allowed(new.tenant_id, chosen) then
    raise exception 'FEATURE_LOCKED:custom_templates' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists invoices_template_entitlement on public.invoices;
create trigger invoices_template_entitlement
  before insert or update of template_key on public.invoices
  for each row execute function public.enforce_invoice_template();

create or replace function public.enforce_default_template()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.default_template is distinct from old.default_template
     and not public.invoice_template_allowed(new.id, new.default_template) then
    raise exception 'FEATURE_LOCKED:custom_templates' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists tenants_default_template on public.tenants;
create trigger tenants_default_template
  before update of default_template on public.tenants
  for each row execute function public.enforce_default_template();

create or replace function public.share_branding(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  share public.invoice_shares;
  seller public.tenants;
  inv public.invoices;
begin
  select * into share from public.invoice_shares s
  where s.token = p_token and s.revoked_at is null and s.expires_at > now();
  if not found then
    return null;
  end if;
  select * into inv from public.invoices where id = share.invoice_id;
  select * into seller from public.tenants where id = inv.tenant_id;
  return jsonb_build_object(
    'logo_url', seller.logo_url,
    'template_key', coalesce(inv.template_key, seller.default_template, 'classic')
  );
end;
$$;

create or replace function public.set_invoice_pdf_url(p_invoice uuid, p_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  tid uuid;
begin
  select tenant_id into tid from public.invoices where id = p_invoice;
  if tid is null or not public.is_member_of(tid) then
    raise exception 'invoice not found' using errcode = '42501';
  end if;
  update public.invoices set pdf_url = p_url where id = p_invoice;
end;
$$;

-- Add the shop logo to the public ledger without changing the rest of the payload.
create or replace function public.get_customer_ledger(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  link public.customer_ledger_links;
  shop public.tenants;
  buyer public.customers;
  invoices jsonb;
  payments jsonb;
  balance numeric;
  razorpay_on boolean;
begin
  select * into link from public.customer_ledger_links
  where token = p_token and revoked_at is null;
  if not found then
    return null;
  end if;
  select * into shop from public.tenants where id = link.tenant_id;
  select * into buyer from public.customers where id = link.customer_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id, 'number', i.number, 'status', i.status, 'total', i.total,
    'issued_at', i.issued_at, 'due_at', i.due_at, 'created_at', i.created_at
  ) order by i.created_at), '[]'::jsonb)
    into invoices
  from public.invoices i
  where i.customer_id = buyer.id and i.tenant_id = shop.id and i.status <> 'void';

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'invoice_id', p.invoice_id, 'amount', p.amount, 'method', p.method,
    'status', p.status, 'paid_at', p.paid_at
  ) order by p.paid_at), '[]'::jsonb)
    into payments
  from public.payments p
  join public.invoices i on i.id = p.invoice_id
  where i.customer_id = buyer.id and i.tenant_id = shop.id and p.status = 'succeeded';

  select greatest(0,
    coalesce((select sum(i.total) from public.invoices i where i.customer_id = buyer.id and i.status <> 'void'), 0)
    - coalesce((
      select sum(p.amount) from public.payments p
      join public.invoices i on i.id = p.invoice_id
      where i.customer_id = buyer.id and p.status = 'succeeded' and i.status <> 'void'
    ), 0)
  ) into balance;

  select exists (
    select 1 from public.tenant_razorpay r
    where r.tenant_id = shop.id and r.enabled and r.key_id is not null
  ) into razorpay_on;

  return jsonb_build_object(
    'shop', jsonb_build_object(
      'name', coalesce(shop.legal_name, shop.name),
      'locale', shop.locale,
      'logo_url', shop.logo_url,
      'upi_vpa', shop.upi_vpa,
      'upi_payee_name', coalesce(shop.upi_payee_name, shop.legal_name, shop.name)
    ),
    'customer', jsonb_build_object('id', buyer.id, 'name', buyer.name),
    'invoices', invoices,
    'payments', payments,
    'balance', balance,
    'razorpay_available', razorpay_on
  );
end;
$$;

alter table public.platform_admins enable row level security;
alter table public.invoice_templates enable row level security;

drop policy if exists invoice_templates_read on public.invoice_templates;
create policy invoice_templates_read on public.invoice_templates
  for select to anon, authenticated
  using (active);

drop policy if exists plans_platform_admin on public.plans;
create policy plans_platform_admin on public.plans
  for select to authenticated
  using (public.is_platform_admin());

drop policy if exists tenants_platform_admin on public.tenants;
create policy tenants_platform_admin on public.tenants
  for select to authenticated
  using (public.is_platform_admin());

drop policy if exists platform_settings_admin on public.platform_settings;
create policy platform_settings_admin on public.platform_settings
  for select to authenticated
  using (public.is_platform_admin());

grant select on public.invoice_templates to anon, authenticated;
grant all privileges on public.platform_admins, public.invoice_templates to service_role;

revoke all on function public.claim_platform_admin() from public, anon;
revoke all on function public.claim_platform_admin_for(uuid) from public, anon, authenticated;
revoke all on function public.is_platform_admin() from public, anon;
revoke all on function public.platform_audit(text, text, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.assert_platform_admin() from public, anon, authenticated;
revoke all on function public.admin_update_plan(text, jsonb) from public, anon;
revoke all on function public.admin_replace_plan_features(text, jsonb) from public, anon;
revoke all on function public.admin_upsert_invoice_template(text, jsonb) from public, anon;
revoke all on function public.admin_set_tenant_status(uuid, text) from public, anon;
revoke all on function public.admin_set_tenant_plan(uuid, text) from public, anon;
revoke all on function public.admin_update_settings(jsonb) from public, anon;
revoke all on function public.invoice_template_allowed(uuid, text) from public, anon, authenticated;
revoke all on function public.list_invoice_templates() from public, anon;
revoke all on function public.share_branding(text) from public;
revoke all on function public.set_invoice_pdf_url(uuid, text) from public, anon;

grant execute on function public.claim_platform_admin() to authenticated;
grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.admin_update_plan(text, jsonb) to authenticated;
grant execute on function public.admin_replace_plan_features(text, jsonb) to authenticated;
grant execute on function public.admin_upsert_invoice_template(text, jsonb) to authenticated;
grant execute on function public.admin_set_tenant_status(uuid, text) to authenticated;
grant execute on function public.admin_set_tenant_plan(uuid, text) to authenticated;
grant execute on function public.admin_update_settings(jsonb) to authenticated;
grant execute on function public.list_invoice_templates() to authenticated;
grant execute on function public.share_branding(text) to anon, authenticated;
grant execute on function public.set_invoice_pdf_url(uuid, text) to authenticated;
grant execute on function public.get_customer_ledger(text) to anon, authenticated;
-- Admin reads go through security-definer functions that refuse non-admins.
-- Public catalog policies stay for GET /billing/plans. They are not an admin API.

create or replace function public.admin_list_plans()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_platform_admin();
  return jsonb_build_object('data', coalesce((
    select jsonb_agg(to_jsonb(p) order by p.sort_order)
    from public.plans p
  ), '[]'::jsonb));
end;
$$;

create or replace function public.admin_list_plan_features(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  plan uuid;
begin
  perform public.assert_platform_admin();
  select id into plan from public.plans where code = p_code;
  if plan is null then
    raise exception 'plan not found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('data', coalesce((
    select jsonb_agg(jsonb_build_object(
      'feature_key', pf.feature_key, 'enabled', pf.enabled, 'limit_value', pf.limit_value
    ) order by pf.feature_key)
    from public.plan_features pf
    where pf.plan_id = plan
  ), '[]'::jsonb));
end;
$$;

create or replace function public.admin_list_templates()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_platform_admin();
  return jsonb_build_object('data', coalesce((
    select jsonb_agg(jsonb_build_object(
      'key', t.key, 'name', t.name, 'description', t.description,
      'required_feature', t.required_feature, 'active', t.active, 'config', t.config
    ) order by t.key)
    from public.invoice_templates t
  ), '[]'::jsonb));
end;
$$;

create or replace function public.admin_list_tenants()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_platform_admin();
  return jsonb_build_object('data', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.id, 'name', t.name, 'slug', t.slug, 'plan', t.plan,
      'status', t.status, 'email', t.email, 'created_at', t.created_at
    ) order by t.created_at desc)
    from (
      select * from public.tenants order by created_at desc limit 200
    ) t
  ), '[]'::jsonb));
end;
$$;

create or replace function public.admin_get_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  row public.platform_settings;
begin
  perform public.assert_platform_admin();
  select * into row from public.platform_settings where id = 1;
  return to_jsonb(row);
end;
$$;

revoke all on function public.admin_list_plans() from public, anon;
revoke all on function public.admin_list_plan_features(text) from public, anon;
revoke all on function public.admin_list_templates() from public, anon;
revoke all on function public.admin_list_tenants() from public, anon;
revoke all on function public.admin_get_settings() from public, anon;

grant execute on function public.admin_list_plans() to authenticated;
grant execute on function public.admin_list_plan_features(text) to authenticated;
grant execute on function public.admin_list_templates() to authenticated;
grant execute on function public.admin_list_tenants() to authenticated;
grant execute on function public.admin_get_settings() to authenticated;
-- Selectable image storage. Supabase Storage buckets are created when the storage schema exists.

alter table public.platform_settings
  add column if not exists storage_provider text not null default 'supabase';

alter table public.platform_settings drop constraint if exists platform_settings_storage_provider;
alter table public.platform_settings
  add constraint platform_settings_storage_provider
  check (storage_provider in ('supabase', 'cloudinary', 'r2'));

create or replace function public.admin_update_settings(p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.platform_settings;
  next_provider text;
begin
  perform public.assert_platform_admin();
  next_provider := p_patch ->> 'storage_provider';
  if next_provider is not null and next_provider not in ('supabase', 'cloudinary', 'r2') then
    raise exception 'storage_provider must be supabase, cloudinary, or r2' using errcode = '22023';
  end if;
  update public.platform_settings
  set app_domain = coalesce(p_patch ->> 'app_domain', app_domain),
      dashboard_host = coalesce(p_patch ->> 'dashboard_host', dashboard_host),
      storage_provider = coalesce(next_provider, storage_provider)
  where id = 1
  returning * into row;
  perform public.platform_audit('settings.update', 'platform_settings', null, null, p_patch);
  return to_jsonb(row);
end;
$$;

revoke all on function public.admin_update_settings(jsonb) from public, anon;
grant execute on function public.admin_update_settings(jsonb) to authenticated;

create or replace function public.ensure_billflow_storage()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    return;
  end if;
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'storage' and table_name = 'buckets'
  ) then
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values
    ('logos', 'logos', true, 2000000, array['image/png', 'image/jpeg', 'image/webp']),
    ('avatars', 'avatars', true, 2000000, array['image/png', 'image/jpeg', 'image/webp']),
    ('bill-photos', 'bill-photos', false, 8000000, array['image/png', 'image/jpeg', 'image/webp', 'application/pdf']),
    ('invoice-pdfs', 'invoice-pdfs', false, 8000000, array['application/pdf'])
  on conflict (id) do update
    set public = excluded.public,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'storage' and table_name = 'objects'
  ) then
    return;
  end if;

  execute 'drop policy if exists billflow_storage_read on storage.objects';
  execute 'drop policy if exists billflow_storage_write on storage.objects';
  execute $policy$
    create policy billflow_storage_read on storage.objects
    for select to anon, authenticated
    using (bucket_id in ('logos', 'avatars'))
  $policy$;
  execute $policy$
    create policy billflow_storage_write on storage.objects
    for all to authenticated
    using (
      bucket_id in ('logos', 'avatars', 'bill-photos', 'invoice-pdfs')
      and split_part(name, '/', 1) = public.current_tenant_id()::text
    )
    with check (
      bucket_id in ('logos', 'avatars', 'bill-photos', 'invoice-pdfs')
      and split_part(name, '/', 1) = public.current_tenant_id()::text
    )
  $policy$;
end;
$$;

revoke all on function public.ensure_billflow_storage() from public, anon, authenticated;
select public.ensure_billflow_storage();
-- Cloudinary credentials saved by a platform admin.
--
-- Hosted Supabase has supabase_vault, but the postgres role cannot call
-- pgsodium's _crypto_aead_det_encrypt. The previous script hit that error on
-- `revoke all on all tables/functions in schema vault` (vault.create_secret
-- exists, so the old shim was skipped and the revoke still touched Vault).
-- This script does not create, replace, or revoke anything in schema vault.
--
-- The API secret is stored with pgcrypto in schema billflow_private.
-- The encryption key is generated once in billflow_private.crypto_key.
-- No API role can read that schema. cloudinary_sign appends the secret in SQL.
-- Re-running is safe, including after the failed hosted attempt.

create schema if not exists extensions;

do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'extensions' and p.proname = 'digest'
  ) then
    execute $fn$
      create function extensions.digest(data text, type text)
      returns bytea language sql stable
      as $body$ select public.digest($1, $2) $body$
    $fn$;
  end if;
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'extensions' and p.proname = 'pgp_sym_encrypt'
  ) then
    execute $fn$
      create function extensions.pgp_sym_encrypt(data text, key text)
      returns bytea language sql volatile
      as $body$ select public.pgp_sym_encrypt($1, $2) $body$
    $fn$;
  end if;
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'extensions' and p.proname = 'pgp_sym_decrypt'
  ) then
    execute $fn$
      create function extensions.pgp_sym_decrypt(data bytea, key text)
      returns text language sql volatile
      as $body$ select public.pgp_sym_decrypt($1, $2) $body$
    $fn$;
  end if;
end $$;

-- Best-effort repair if the previous script revoked service_role on Vault.
-- Failure is ignored so a pgsodium event trigger cannot stop this script.
do $$
begin
  if to_regnamespace('vault') is null then
    return;
  end if;
  begin
    execute 'grant usage on schema vault to service_role';
  exception when others then
    raise notice 'vault usage grant left unchanged: %', sqlerrm;
  end;
  begin
    execute 'grant select, insert, update, delete on all tables in schema vault to service_role';
  exception when others then
    raise notice 'vault table grants left unchanged: %', sqlerrm;
  end;
  begin
    execute 'grant execute on all functions in schema vault to service_role';
  exception when others then
    raise notice 'vault function grants left unchanged: %', sqlerrm;
  end;
end $$;

create schema if not exists billflow_private;

revoke all on schema billflow_private from public, anon, authenticated, service_role;

create table if not exists billflow_private.crypto_key (
  id integer primary key check (id = 1),
  key text not null
);

insert into billflow_private.crypto_key (id, key)
select 1, encode(extensions.gen_random_bytes(32), 'hex')
where not exists (select 1 from billflow_private.crypto_key where id = 1);

create table if not exists billflow_private.secrets (
  id uuid primary key default gen_random_uuid(),
  name text,
  secret_enc bytea not null,
  updated_at timestamptz not null default now()
);

revoke all on all tables in schema billflow_private from public, anon, authenticated, service_role;

create table if not exists public.cloudinary_settings (
  id integer primary key check (id = 1),
  cloud_name text,
  api_key text,
  vault_secret_id uuid,
  updated_at timestamptz not null default now()
);

alter table public.cloudinary_settings
  add column if not exists cloud_name text,
  add column if not exists api_key text,
  add column if not exists vault_secret_id uuid,
  add column if not exists updated_at timestamptz not null default now();

insert into public.cloudinary_settings (id) values (1) on conflict (id) do nothing;

alter table public.cloudinary_settings enable row level security;
revoke all on table public.cloudinary_settings from public, anon, authenticated, service_role;

create or replace function public.cloudinary_read_secret()
returns text
language plpgsql
security definer
set search_path = public, billflow_private, extensions
as $$
declare
  secret_id uuid;
  pass text;
  raw bytea;
  secret text;
begin
  select vault_secret_id into secret_id from public.cloudinary_settings where id = 1;
  if secret_id is null then
    return null;
  end if;
  select key into pass from billflow_private.crypto_key where id = 1;
  select secret_enc into raw from billflow_private.secrets where id = secret_id;
  if raw is null or pass is null then
    return null;
  end if;
  secret := extensions.pgp_sym_decrypt(raw, pass);
  if secret is null or secret = '' then
    return null;
  end if;
  return secret;
end;
$$;

create or replace function public.cloudinary_public_config()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.cloudinary_settings;
  secret text;
begin
  if public.current_tenant_id() is null and not public.is_platform_admin() then
    raise exception 'an active tenant is required' using errcode = '42501';
  end if;
  select * into row from public.cloudinary_settings where id = 1;
  secret := public.cloudinary_read_secret();
  return jsonb_build_object(
    'cloud_name', row.cloud_name,
    'api_key', row.api_key,
    'secret_set', secret is not null
  );
end;
$$;

create or replace function public.cloudinary_sign(p_params_to_sign text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  secret text;
begin
  if auth.uid() is null or public.current_tenant_id() is null then
    raise exception 'an active tenant is required' using errcode = '42501';
  end if;
  if p_params_to_sign is null or btrim(p_params_to_sign) = '' then
    raise exception 'params to sign are required' using errcode = '22023';
  end if;
  secret := public.cloudinary_read_secret();
  if secret is null then
    raise exception 'cloudinary is not configured' using errcode = '22023';
  end if;
  return encode(extensions.digest(p_params_to_sign || secret, 'sha1'), 'hex');
end;
$$;

create or replace function public.admin_set_cloudinary(p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, billflow_private, extensions
as $$
declare
  row public.cloudinary_settings;
  secret text;
  pass text;
  new_id uuid;
begin
  perform public.assert_platform_admin();
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'cloudinary settings must be an object' using errcode = '22023';
  end if;
  insert into public.cloudinary_settings (id) values (1) on conflict (id) do nothing;
  select * into row from public.cloudinary_settings where id = 1 for update;
  select key into pass from billflow_private.crypto_key where id = 1;
  if pass is null then
    raise exception 'cloudinary secret key is missing' using errcode = '22023';
  end if;

  if p_patch ? 'cloud_name' then
    row.cloud_name := nullif(btrim(coalesce(p_patch ->> 'cloud_name', '')), '');
  end if;
  if p_patch ? 'api_key' then
    row.api_key := nullif(btrim(coalesce(p_patch ->> 'api_key', '')), '');
  end if;
  if p_patch ? 'api_secret' and jsonb_typeof(p_patch -> 'api_secret') = 'string' and length(btrim(p_patch ->> 'api_secret')) > 0 then
    secret := p_patch ->> 'api_secret';
    if row.vault_secret_id is null or not exists (
      select 1 from billflow_private.secrets s where s.id = row.vault_secret_id
    ) then
      insert into billflow_private.secrets (name, secret_enc)
      values ('billflow_cloudinary_api_secret', extensions.pgp_sym_encrypt(secret, pass))
      returning id into new_id;
      row.vault_secret_id := new_id;
    else
      update billflow_private.secrets
      set secret_enc = extensions.pgp_sym_encrypt(secret, pass),
          updated_at = now()
      where id = row.vault_secret_id;
    end if;
  elsif p_patch ? 'api_secret' and jsonb_typeof(p_patch -> 'api_secret') = 'null' then
    if row.vault_secret_id is not null then
      update billflow_private.secrets
      set secret_enc = extensions.pgp_sym_encrypt('', pass),
          updated_at = now()
      where id = row.vault_secret_id;
    end if;
    row.vault_secret_id := null;
  end if;

  update public.cloudinary_settings
  set cloud_name = row.cloud_name,
      api_key = row.api_key,
      vault_secret_id = row.vault_secret_id,
      updated_at = now()
  where id = 1;

  perform public.platform_audit('cloudinary.update', 'cloudinary_settings', null, null, jsonb_build_object(
    'cloud_name_set', row.cloud_name is not null,
    'api_key_set', row.api_key is not null,
    'secret_updated', p_patch ? 'api_secret' and jsonb_typeof(p_patch -> 'api_secret') = 'string' and length(btrim(coalesce(p_patch ->> 'api_secret', ''))) > 0,
    'secret_cleared', p_patch ? 'api_secret' and jsonb_typeof(p_patch -> 'api_secret') = 'null'
  ));
  return public.cloudinary_public_config();
end;
$$;

revoke all on function public.cloudinary_read_secret() from public, anon, authenticated, service_role;
revoke all on function public.cloudinary_public_config() from public, anon;
revoke all on function public.cloudinary_sign(text) from public, anon;
revoke all on function public.admin_set_cloudinary(jsonb) from public, anon;

grant execute on function public.cloudinary_public_config() to authenticated;
grant execute on function public.cloudinary_sign(text) to authenticated;
grant execute on function public.admin_set_cloudinary(jsonb) to authenticated;
-- Shop photos: product images, public product and site buckets, and website hero/about URLs.
-- Re-running is safe. https is required. Bestsellers are the last 30 days, else the newest products.

alter table public.products
  add column if not exists image_url text;

alter table public.products drop constraint if exists products_image_url_https;
alter table public.products
  add constraint products_image_url_https
  check (image_url is null or image_url ~* '^https://\S+$');

create or replace function public.https_or_null(p_value text)
returns text
language sql
immutable
as $$
  select case
    when p_value is null or btrim(p_value) = '' then null
    when btrim(p_value) ~* '^https://\S+$' then btrim(p_value)
    else null
  end
$$;

create or replace function public.assert_https_site_images()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  key text;
  value text;
begin
  foreach key in array array['hero_image_url', 'about_image_url']
  loop
    value := nullif(btrim(coalesce(new.overrides ->> key, '')), '');
    if value is not null and value !~* '^https://\S+$' then
      raise exception '% must be an https URL', key using errcode = '22023';
    end if;
    value := nullif(btrim(coalesce(new.published_overrides ->> key, '')), '');
    if value is not null and value !~* '^https://\S+$' then
      raise exception '% must be an https URL', key using errcode = '22023';
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists tenant_template_settings_https_images on public.tenant_template_settings;
create trigger tenant_template_settings_https_images
  before insert or update of overrides, published_overrides on public.tenant_template_settings
  for each row execute function public.assert_https_site_images();

create or replace function public.shop_products(p_tenant uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'price', p.price,
    'image_url', p.image_url
  ) order by p.name), '[]'::jsonb)
  from public.products p
  where p.tenant_id = p_tenant and p.active
$$;

create or replace function public.shop_bestsellers(p_tenant uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ranked.id,
    'name', ranked.name,
    'price', ranked.price,
    'image_url', ranked.image_url
  ) order by ranked.sold_qty desc, ranked.name), '[]'::jsonb)
    into result
  from (
    select p.id, p.name, p.price, p.image_url, sum(it.quantity) as sold_qty
    from public.invoice_items it
    join public.invoices i on i.id = it.invoice_id
    join public.products p
      on p.tenant_id = p_tenant
     and p.active
     and (
       p.id = it.product_id
       or (it.product_id is null and lower(p.name) = lower(it.description))
     )
    where i.tenant_id = p_tenant
      and i.status <> 'void'
      and i.created_at > now() - interval '30 days'
    group by p.id, p.name, p.price, p.image_url
    order by sold_qty desc, p.name
    limit 6
  ) ranked;

  if result is null or result = '[]'::jsonb then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', newest.id,
      'name', newest.name,
      'price', newest.price,
      'image_url', newest.image_url
    ) order by newest.created_at desc), '[]'::jsonb)
      into result
    from (
      select p.id, p.name, p.price, p.image_url, p.created_at
      from public.products p
      where p.tenant_id = p_tenant and p.active
      order by p.created_at desc
      limit 6
    ) newest;
  end if;
  return coalesce(result, '[]'::jsonb);
end;
$$;

create or replace function public.get_site_by_host(p_host text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  h text := lower(rtrim(split_part(coalesce(p_host, ''), ':', 1), '.'));
  app_domain text;
  tid uuid;
  sub text;
  tname text;
  logo text;
  currency text;
  slug text;
  via_custom boolean;
  tmpl_slug text;
  tmpl_name text;
  base_config jsonb;
  published jsonb;
  published_at timestamptz;
  legacy_title text;
  legacy_tagline text;
  legacy_about text;
  legacy_published boolean;
  site jsonb;
begin
  if h = '' then
    return null;
  end if;

  select s.app_domain into app_domain from public.platform_settings s where s.id = 1;
  app_domain := lower(coalesce(app_domain, 'billflow.com'));

  select t.id, coalesce(t.subdomain, t.slug), t.slug, t.name, t.logo_url, t.currency,
         (d.id is not null or site_row.id is not null)
    into tid, sub, slug, tname, logo, currency, via_custom
  from public.tenants t
  left join public.tenant_domains d
    on d.tenant_id = t.id and d.verified and lower(d.domain) = h
  left join public.sites site_row
    on site_row.tenant_id = t.id and lower(site_row.custom_domain) = h
  where d.id is not null
     or site_row.id is not null
     or lower(coalesce(t.subdomain, t.slug)) = h
     or lower(coalesce(t.subdomain, t.slug)) || '.' || app_domain = h
     or lower(coalesce(t.subdomain, t.slug)) || '.localhost' = h
  order by case when d.id is not null or site_row.id is not null then 0 else 1 end
  limit 1;

  if tid is null then
    return null;
  end if;
  if via_custom and not public.has_feature(tid, 'custom_domains') then
    return null;
  end if;

  select ts.published_overrides, ts.published_at, tmpl.config, tmpl.slug, tmpl.name
    into published, published_at, base_config, tmpl_slug, tmpl_name
  from public.tenant_template_settings ts
  join public.templates tmpl on tmpl.id = ts.template_id
  where ts.tenant_id = tid
    and ts.published_at is not null;

  if published_at is not null then
    published := coalesce(published, '{}'::jsonb);
    base_config := coalesce(base_config, '{}'::jsonb);
    if tmpl_slug is distinct from 'classic' and not public.has_feature(tid, 'custom_templates') then
      select tmpl.config, tmpl.slug, tmpl.name
        into base_config, tmpl_slug, tmpl_name
      from public.templates tmpl
      where tmpl.slug = 'classic';
      published := published - 'colors' - 'fonts' - 'layout' - 'sections';
    end if;
    site := jsonb_build_object(
      'tenant_id', tid,
      'slug', slug,
      'subdomain', sub,
      'name', tname,
      'title', coalesce(published ->> 'title', tname),
      'tagline', published ->> 'tagline',
      'about', published ->> 'about',
      'logo_url', coalesce(published ->> 'logo_url', logo),
      'hero_image_url', public.https_or_null(published ->> 'hero_image_url'),
      'about_image_url', public.https_or_null(published ->> 'about_image_url'),
      'published', true,
      'host', h,
      'currency', currency,
      'template', jsonb_build_object('slug', tmpl_slug, 'name', tmpl_name),
      'config', jsonb_build_object(
        'colors', coalesce(base_config -> 'colors', '{}'::jsonb) || coalesce(published -> 'colors', '{}'::jsonb),
        'fonts', coalesce(base_config -> 'fonts', '{}'::jsonb) || coalesce(published -> 'fonts', '{}'::jsonb),
        'layout', coalesce(base_config -> 'layout', '{}'::jsonb) || coalesce(published -> 'layout', '{}'::jsonb),
        'sections', case
          when jsonb_typeof(published -> 'sections') = 'array' then published -> 'sections'
          else coalesce(base_config -> 'sections', '[]'::jsonb)
        end
      ),
      'products', public.shop_products(tid),
      'bestsellers', public.shop_bestsellers(tid)
    );
    return site;
  end if;

  select site_row.title, site_row.tagline, site_row.about, site_row.published
    into legacy_title, legacy_tagline, legacy_about, legacy_published
  from public.sites site_row
  where site_row.tenant_id = tid;

  if coalesce(legacy_published, false) = false then
    return null;
  end if;

  return jsonb_build_object(
    'tenant_id', tid,
    'slug', slug,
    'subdomain', sub,
    'name', tname,
    'title', coalesce(legacy_title, tname),
    'tagline', legacy_tagline,
    'about', legacy_about,
    'logo_url', logo,
    'hero_image_url', null,
    'about_image_url', null,
    'published', true,
    'host', h,
    'currency', currency,
    'template', jsonb_build_object('slug', 'classic', 'name', 'Classic'),
    'config', '{}'::jsonb,
    'products', public.shop_products(tid),
    'bestsellers', public.shop_bestsellers(tid)
  );
end;
$$;

revoke all on function public.https_or_null(text) from public, anon, authenticated;
revoke all on function public.assert_https_site_images() from public, anon, authenticated;
revoke all on function public.shop_products(uuid) from public, anon, authenticated;
revoke all on function public.shop_bestsellers(uuid) from public, anon, authenticated;
revoke all on function public.get_site_by_host(text) from public;
grant execute on function public.get_site_by_host(text) to anon, authenticated, service_role;

create or replace function public.ensure_billflow_storage()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    return;
  end if;
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'storage' and table_name = 'buckets'
  ) then
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values
    ('logos', 'logos', true, 2000000, array['image/png', 'image/jpeg', 'image/webp']),
    ('avatars', 'avatars', true, 2000000, array['image/png', 'image/jpeg', 'image/webp']),
    ('products', 'products', true, 2000000, array['image/png', 'image/jpeg', 'image/webp']),
    ('site-images', 'site-images', true, 2000000, array['image/png', 'image/jpeg', 'image/webp']),
    ('bill-photos', 'bill-photos', false, 8000000, array['image/png', 'image/jpeg', 'image/webp', 'application/pdf']),
    ('invoice-pdfs', 'invoice-pdfs', false, 8000000, array['application/pdf'])
  on conflict (id) do update
    set public = excluded.public,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'storage' and table_name = 'objects'
  ) then
    return;
  end if;

  execute 'drop policy if exists billflow_storage_read on storage.objects';
  execute 'drop policy if exists billflow_storage_write on storage.objects';
  execute $policy$
    create policy billflow_storage_read on storage.objects
    for select to anon, authenticated
    using (bucket_id in ('logos', 'avatars', 'products', 'site-images'))
  $policy$;
  execute $policy$
    create policy billflow_storage_write on storage.objects
    for all to authenticated
    using (
      bucket_id in ('logos', 'avatars', 'products', 'site-images', 'bill-photos', 'invoice-pdfs')
      and split_part(name, '/', 1) = public.current_tenant_id()::text
    )
    with check (
      bucket_id in ('logos', 'avatars', 'products', 'site-images', 'bill-photos', 'invoice-pdfs')
      and split_part(name, '/', 1) = public.current_tenant_id()::text
    )
  $policy$;
end;
$$;

revoke all on function public.ensure_billflow_storage() from public, anon, authenticated;
select public.ensure_billflow_storage();
