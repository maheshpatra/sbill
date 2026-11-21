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
