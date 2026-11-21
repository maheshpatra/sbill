-- Admin plan changes failed for tenants that already had an open legacy
-- public.subscriptions row and no matching public.tenant_subscriptions row.
-- admin_set_tenant_plan inserted a new tenant_subscriptions id, and
-- sync_tenant_to_subscription then inserted a second open subscriptions row.
-- subscriptions_one_open_per_tenant rejected that insert, so the plan never changed.
--
-- The mirror trigger now updates the existing open subscription instead of
-- inserting another one. The admin function writes both tables itself, reusing
-- the legacy id, and a backfill copies any open subscription that was never mirrored.

create or replace function public.sync_tenant_to_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  chosen_name text;
  open_id uuid;
begin
  if current_setting('billflow.syncing', true) = '1' then
    return new;
  end if;
  perform set_config('billflow.syncing', '1', true);
  select p.name into chosen_name from public.plans p where p.id = new.plan_id;

  select s.id into open_id
  from public.subscriptions s
  where s.tenant_id = new.tenant_id
    and s.status in ('trialing', 'active', 'past_due', 'paused')
    and s.id is distinct from new.id
  order by s.created_at desc
  limit 1;

  if open_id is not null then
    update public.subscriptions
    set plan_id = new.plan_id,
        plan_name = coalesce(chosen_name, plan_name),
        price = new.price_paise / 100.0,
        billing_cycle = new.billing_cycle,
        status = new.status,
        current_period_start = new.current_period_start,
        current_period_end = new.current_period_end,
        cancel_at_period_end = new.cancel_at_period_end,
        provider = new.provider,
        external_id = new.provider_subscription_id
    where id = open_id;
  else
    insert into public.subscriptions (
      id, tenant_id, plan_id, plan_name, price, currency, billing_cycle, status,
      start_date, current_period_start, current_period_end, cancel_at_period_end, provider, external_id
    ) values (
      new.id, new.tenant_id, new.plan_id, coalesce(chosen_name, 'Plan'), new.price_paise / 100.0, 'INR',
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
  end if;

  update public.tenants
  set plan = (select p.code from public.plans p where p.id = new.plan_id)
  where id = new.tenant_id;
  perform set_config('billflow.syncing', '', true);
  return new;
end;
$$;

create or replace function public.admin_set_tenant_plan(p_tenant uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  chosen_id uuid;
  chosen_name text;
  chosen_price integer;
  sub_id uuid;
  legacy_id uuid;
  mirror_id uuid;
begin
  perform public.assert_platform_admin();

  select p.id, p.name, p.price_monthly_paise
    into chosen_id, chosen_name, chosen_price
  from public.plans p
  where p.code = p_code
    and p.active;
  if chosen_id is null then
    raise exception 'plan not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.tenants t where t.id = p_tenant) then
    raise exception 'tenant not found' using errcode = 'P0002';
  end if;

  select ts.id into sub_id
  from public.tenant_subscriptions ts
  where ts.tenant_id = p_tenant
    and ts.status in ('trialing', 'active', 'past_due', 'paused')
  order by ts.created_at desc
  limit 1;

  select s.id into legacy_id
  from public.subscriptions s
  where s.tenant_id = p_tenant
    and s.status in ('trialing', 'active', 'past_due', 'paused')
  order by s.created_at desc
  limit 1;

  -- Hold the mirror triggers. They would otherwise insert a second open row
  -- when the platform subscription and the legacy mirror do not share an id.
  perform set_config('billflow.syncing', '1', true);

  if sub_id is not null then
    update public.tenant_subscriptions
    set plan_id = chosen_id,
        pending_plan_id = null,
        price_paise = coalesce(chosen_price, 0),
        cancel_at_period_end = false
    where id = sub_id;
    mirror_id := sub_id;
  else
    insert into public.tenant_subscriptions (
      id, tenant_id, plan_id, status, billing_cycle, current_period_start, current_period_end, price_paise
    ) values (
      coalesce(legacy_id, gen_random_uuid()),
      p_tenant,
      chosen_id,
      'active',
      'monthly',
      current_date,
      current_date + 30,
      coalesce(chosen_price, 0)
    )
    on conflict (id) do update
      set plan_id = excluded.plan_id,
          pending_plan_id = null,
          price_paise = excluded.price_paise,
          cancel_at_period_end = false,
          status = 'active'
    returning id into mirror_id;
  end if;

  if legacy_id is not null then
    update public.subscriptions
    set plan_id = chosen_id,
        plan_name = coalesce(chosen_name, plan_name),
        price = coalesce(chosen_price, 0) / 100.0
    where id = legacy_id;
  else
    insert into public.subscriptions (
      id, tenant_id, plan_id, plan_name, price, currency, billing_cycle, status,
      start_date, current_period_start, current_period_end
    ) values (
      mirror_id,
      p_tenant,
      chosen_id,
      coalesce(chosen_name, 'Plan'),
      coalesce(chosen_price, 0) / 100.0,
      'INR',
      'monthly',
      'active',
      current_date,
      current_date,
      current_date + 30
    )
    on conflict (id) do update
      set plan_id = excluded.plan_id,
          plan_name = excluded.plan_name,
          price = excluded.price;
  end if;

  update public.tenants
  set plan = p_code
  where id = p_tenant;

  perform set_config('billflow.syncing', '', true);
  perform public.platform_audit('tenant.plan', 'tenant', p_tenant, p_tenant, jsonb_build_object('plan', p_code));
  return jsonb_build_object('id', p_tenant, 'plan', p_code);
end;
$$;

select set_config('billflow.syncing', '1', true);

insert into public.tenant_subscriptions (
  id, tenant_id, plan_id, status, billing_cycle, current_period_start, current_period_end,
  price_paise, cancel_at_period_end, provider, provider_subscription_id
)
select
  s.id,
  s.tenant_id,
  s.plan_id,
  s.status,
  s.billing_cycle,
  s.current_period_start,
  s.current_period_end,
  greatest(0, round(s.price * 100)::integer),
  s.cancel_at_period_end,
  s.provider,
  s.external_id
from public.subscriptions s
where s.status in ('trialing', 'active', 'past_due', 'paused')
  and s.plan_id is not null
  and not exists (
    select 1
    from public.tenant_subscriptions ts
    where ts.tenant_id = s.tenant_id
      and ts.status in ('trialing', 'active', 'past_due', 'paused')
  )
on conflict (id) do nothing;

select set_config('billflow.syncing', '', true);

revoke all on function public.admin_set_tenant_plan(uuid, text) from public, anon;
grant execute on function public.admin_set_tenant_plan(uuid, text) to authenticated;
