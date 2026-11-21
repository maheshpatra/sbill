-- Standalone fix for a project that already has billflow_full.sql and 2026-11-20_frontend_gaps.sql applied.
-- Safe to run more than once.

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
