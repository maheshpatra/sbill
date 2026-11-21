-- Standalone fix for a hosted project that already has the 2026-11-20 fix scripts through purchases_categories.
-- Safe to run more than once.

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
