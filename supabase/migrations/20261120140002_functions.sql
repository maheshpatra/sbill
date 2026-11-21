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
