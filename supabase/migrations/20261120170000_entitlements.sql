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
