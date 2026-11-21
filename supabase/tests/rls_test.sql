-- Proves tenant isolation and role rules against the local auth stub.
-- Run as a superuser session (see supabase/tests/run.sh). Any failure raises.

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Grants (automatic Data API grants are off; migration must grant these)
-- ---------------------------------------------------------------------------

do $$
begin
  if not has_table_privilege('authenticated', 'public.invoices', 'select') then
    raise exception 'authenticated cannot select invoices';
  end if;
  if not has_table_privilege('authenticated', 'public.invoices', 'insert') then
    raise exception 'authenticated cannot insert invoices';
  end if;
  if has_table_privilege('anon', 'public.invoices', 'select') then
    raise exception 'anon must not be able to select invoices';
  end if;
  if not has_table_privilege('anon', 'public.plans', 'select') then
    raise exception 'anon cannot select plans';
  end if;
  if not has_function_privilege('anon', 'public.get_site_by_host(text)', 'execute') then
    raise exception 'anon cannot execute get_site_by_host';
  end if;
  if has_function_privilege('anon', 'public.current_tenant_id()', 'execute') then
    raise exception 'anon must not execute current_tenant_id';
  end if;
  if has_function_privilege('authenticated', 'public.mark_overdue_invoices()', 'execute') then
    raise exception 'authenticated must not execute mark_overdue_invoices';
  end if;
  if has_function_privilege('authenticated', 'public.custom_access_token_hook(jsonb)', 'execute') then
    raise exception 'authenticated must not execute the auth hook';
  end if;
  if not has_function_privilege('authenticated', 'public.create_tenant(text,text)', 'execute') then
    raise exception 'authenticated cannot execute create_tenant';
  end if;
  if not has_function_privilege('service_role', 'public.mark_overdue_invoices()', 'execute') then
    raise exception 'service_role cannot execute mark_overdue_invoices';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Seed math and published-site lookup
-- ---------------------------------------------------------------------------

do $$
declare
  tot numeric;
  st public.invoice_status;
  igst numeric;
  cgst numeric;
begin
  select total, status into tot, st
  from public.invoices
  where id = '40000000-0000-4000-8000-000000000001';
  if tot <> 23600 then
    raise exception 'Acme INV-0001 total is %, expected 23600', tot;
  end if;
  if st <> 'paid' then
    raise exception 'Acme INV-0001 status is %, expected paid', st;
  end if;

  select igst_amount into igst
  from public.invoice_items
  where id = '41000000-0000-4000-8000-000000000004';
  if igst <> 1440 then
    raise exception 'Northwind inter-state IGST is %, expected 1440', igst;
  end if;

  select cgst_amount into cgst
  from public.invoice_items
  where id = '41000000-0000-4000-8000-000000000001';
  if cgst <> 1800 then
    raise exception 'Acme CGST is %, expected 1800', cgst;
  end if;

  if (select count(*) from public.tenants) < 3 then
    raise exception 'expected at least 3 seeded tenants';
  end if;
  if (select count(*) from public.plans where is_public and active) < 4 then
    raise exception 'expected 4 public plans';
  end if;
  if public.has_feature('20000000-0000-4000-8000-000000000004', 'gst_invoices') then
    raise exception 'free tenant Plain Goods has GST invoices';
  end if;
  if not public.has_feature('20000000-0000-4000-8000-000000000001', 'pos') then
    raise exception 'growth tenant Acme is missing POS';
  end if;
  if public.has_feature('20000000-0000-4000-8000-000000000002', 'pos') then
    raise exception 'starter tenant Northwind has POS';
  end if;
  if not public.has_feature('20000000-0000-4000-8000-000000000003', 'custom_domains') then
    raise exception 'business tenant Saffron is missing custom domains';
  end if;
  if not public.has_feature('20000000-0000-4000-8000-000000000004', 'cash_payments') then
    raise exception 'free tenant is missing cash';
  end if;
  if not public.has_feature('20000000-0000-4000-8000-000000000004', 'upi_qr') then
    raise exception 'free tenant is missing UPI QR';
  end if;
end $$;

-- Entitlement reads must not fail with an ambiguous plan_id.
-- Session scope: a local set_config ends before the next statement.
select set_config('request.jwt.claim.role', 'service_role', false);
do $$
declare
  ent jsonb;
begin
  ent := public.tenant_entitlements('20000000-0000-4000-8000-000000000004');
  if ent ->> 'plan' <> 'free' then
    raise exception 'Plain Goods entitlements plan is %', ent ->> 'plan';
  end if;
  if (ent -> 'features' ->> 'cash_payments') <> 'true' then
    raise exception 'free plan entitlements missing cash_payments';
  end if;
  if public.feature_limit('20000000-0000-4000-8000-000000000004', 'max_users') <> 1 then
    raise exception 'free user cap was not readable';
  end if;
  if public.usage_exceeds_plan(
    '20000000-0000-4000-8000-000000000004',
    (select id from public.plans where code = 'free')
  ) then
    raise exception 'free tenant was reported over its plan';
  end if;
end $$;
select set_config('request.jwt.claim.role', '', false);

do $$
declare
  site jsonb;
begin
  site := public.get_site_by_host('acme.billflow.com');
  if site ->> 'slug' <> 'acme' then
    raise exception 'expected acme site, got %', site;
  end if;
  site := public.get_site_by_host('pay.saffronretail.in');
  if site ->> 'slug' <> 'saffron' then
    raise exception 'expected saffron custom domain, got %', site;
  end if;
  if public.get_site_by_host('northwind.billflow.com') is not null then
    raise exception 'unpublished northwind site must not resolve';
  end if;
  if public.get_site_by_host('no-such.billflow.com') is not null then
    raise exception 'unknown host must not resolve';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Fixtures: two tenants, four users. Owner A, member A, billing A, owner B,
-- and a user who belongs to both.
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'owner-a@example.com', '{"name":"Owner A"}'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'owner-b@example.com', '{"name":"Owner B"}'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 'member-a@example.com', '{"name":"Member A"}'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', 'billing-a@example.com', '{"name":"Billing A"}'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5', 'both@example.com', '{"name":"Both"}'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6', 'new-owner@example.com', '{"name":"New Owner"}');

insert into public.tenants (id, name, slug, plan, status) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'Tenant A', 'tenant-a', 'starter', 'active'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'Tenant B', 'tenant-b', 'starter', 'active');

insert into public.memberships (tenant_id, user_id, role, status) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'owner', 'active'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'owner', 'active'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 'member', 'active'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', 'billing', 'active'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5', 'admin', 'active'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5', 'member', 'active');

insert into public.customers (id, tenant_id, name) values
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'Customer A'),
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc2', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'Customer B');

insert into public.invoices (id, tenant_id, customer_id, number, status) values
  ('dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', 'INV-9001', 'draft'),
  ('dddddddd-dddd-4ddd-8ddd-ddddddddddd2', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2', 'INV-9001', 'draft');

insert into public.invoice_items (tenant_id, invoice_id, description, quantity, unit_price, tax_rate) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 'Work', 1, 100, 0),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2', 'Work', 1, 100, 0);

-- ---------------------------------------------------------------------------
-- Owner A sees tenant A only. A forged tenant_id claim does not widen that.
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', false);
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.tenant_id', '', false);
set role authenticated;

do $$
declare
  c int;
begin
  select count(*) into c from public.invoices where tenant_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
  if c <> 1 then raise exception 'owner A saw % invoices in A, expected 1', c; end if;

  select count(*) into c from public.invoices where tenant_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
  if c <> 0 then raise exception 'owner A saw % invoices in B', c; end if;

  select count(*) into c from public.invoices where id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2';
  if c <> 0 then raise exception 'owner A read tenant B invoice by id'; end if;

  select count(*) into c from public.customers where id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';
  if c <> 0 then raise exception 'owner A read tenant B customer'; end if;

  select count(*) into c from public.invoices where tenant_id = '20000000-0000-4000-8000-000000000001';
  if c <> 0 then raise exception 'owner A read seeded Acme invoices'; end if;

  select count(*) into c from public.tenants;
  if c <> 1 then raise exception 'owner A sees % tenants, expected 1', c; end if;
end $$;

-- Checkout and messaging settings are owner RPCs. They do not need service_role.
do $$
declare
  flags jsonb;
  checkout jsonb;
begin
  perform public.save_messaging_settings(
    'msg91', 'none', 'SENDER', null, null, null, null, null, null,
    'ciphertext', '{"msg91_auth_key": true}'::jsonb
  );
  flags := public.messaging_secret_flags();
  if (flags ->> 'msg91_auth_key') <> 'true' then
    raise exception 'messaging flags missing, got %', flags;
  end if;
  if public.messaging_secrets_enc() <> 'ciphertext' then
    raise exception 'messaging ciphertext was not stored for the owner';
  end if;

  checkout := public.record_billing_checkout(
    (select id from public.plans where code = 'free'),
    'monthly',
    0,
    'manual',
    'user-checkout-1'
  );
  if checkout ->> 'tenant_id' <> 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1' then
    raise exception 'user checkout landed on %', checkout ->> 'tenant_id';
  end if;
  if checkout ->> 'status' <> 'pending' then
    raise exception 'user checkout status is %', checkout ->> 'status';
  end if;
end $$;

do $$
begin
  perform secrets from public.messaging_settings;
  raise exception 'authenticated read messaging secrets';
exception
  when insufficient_privilege then
    null;
end $$;

do $$
declare n int;
begin
  update public.invoices set notes = 'hack' where id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'owner A updated tenant B invoice'; end if;

  delete from public.customers where id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'owner A deleted tenant B customer'; end if;
end $$;

do $$
begin
  insert into public.invoices (tenant_id, customer_id, number)
  values (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
    'INV-HACK'
  );
  raise exception 'owner A inserted into tenant B';
exception
  when insufficient_privilege then
    null;
end $$;

reset role;
select set_config('request.jwt.claim.tenant_id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', false);
set role authenticated;

do $$
declare c int;
begin
  select count(*) into c from public.invoices where tenant_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
  if c <> 0 then
    raise exception 'forged tenant_id claim let owner A see tenant B (% rows)', c;
  end if;
  select count(*) into c from public.invoices where tenant_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
  if c <> 1 then
    raise exception 'forged claim hid tenant A from its owner (% rows)', c;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Member is read-only. Billing can create an invoice and record a payment.
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', false);
select set_config('request.jwt.claim.tenant_id', '', false);
set role authenticated;

do $$
declare c int;
begin
  select count(*) into c from public.invoices;
  if c <> 1 then raise exception 'member expected to read 1 invoice, saw %', c; end if;
end $$;

do $$
begin
  perform public.messaging_secret_flags();
  raise exception 'member read messaging secret flags';
exception
  when insufficient_privilege then
    null;
end $$;

do $$
begin
  insert into public.invoices (tenant_id, customer_id)
  values (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'
  );
  raise exception 'member inserted an invoice';
exception
  when insufficient_privilege then
    null;
end $$;

do $$
declare n int;
begin
  update public.invoices set notes = 'member edit' where id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'member updated an invoice'; end if;
end $$;

reset role;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', false);
select set_config('request.jwt.claim.tenant_id', '', false);
set role authenticated;

do $$
declare
  inv uuid;
  st public.invoice_status;
  tot numeric;
begin
  insert into public.invoices (tenant_id, customer_id, notes)
  values (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
    'Billing-created'
  )
  returning id into inv;

  insert into public.invoice_items (tenant_id, invoice_id, description, quantity, unit_price, tax_rate)
  values (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    inv,
    'Filing',
    1, 1000, 18
  );

  select total into tot from public.invoices where id = inv;
  if tot <> 1180 then
    raise exception 'server-side total is %, expected 1180', tot;
  end if;

  insert into public.payments (tenant_id, invoice_id, amount, method, status, transaction_ref)
  values (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    inv, 1180, 'upi', 'succeeded', 'UPI-RLS-BILLING'
  );

  select status into st from public.invoices where id = inv;
  if st <> 'paid' then
    raise exception 'mark-paid left status %, expected paid', st;
  end if;
end $$;

do $$
declare n int;
begin
  delete from public.invoices where notes = 'Billing-created';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'billing role deleted an invoice (admin only, and it is not draft)'; end if;
end $$;

do $$
begin
  insert into public.invoices (tenant_id, customer_id)
  values (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc2'
  );
  raise exception 'billing user inserted into tenant B';
exception
  when insufficient_privilege then
    null;
end $$;

-- ---------------------------------------------------------------------------
-- A user in both tenants follows the JWT claim, still only one tenant at a time.
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5', false);
select set_config('request.jwt.claim.tenant_id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', false);
set role authenticated;

do $$
declare c int;
begin
  select count(*) into c from public.invoices where tenant_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
  if c <> 1 then raise exception 'dual member with claim B saw % invoices in B', c; end if;
  select count(*) into c from public.invoices where tenant_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
  if c <> 0 then raise exception 'dual member with claim B still saw tenant A invoices'; end if;
end $$;

-- Claim does not grant a write role the membership does not have (member of B).
do $$
begin
  insert into public.invoices (tenant_id, customer_id)
  values (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc2'
  );
  raise exception 'member role in B inserted an invoice via tenant claim';
exception
  when insufficient_privilege then
    null;
end $$;

-- ---------------------------------------------------------------------------
-- create_tenant makes the caller the owner. set_active_tenant rejects strangers.
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6', false);
select set_config('request.jwt.claim.tenant_id', '', false);
set role authenticated;

do $$
declare
  created jsonb;
  c int;
begin
  created := public.create_tenant('RLS Goods', 'rls-goods');
  if created ->> 'role' <> 'owner' then
    raise exception 'create_tenant role is %', created ->> 'role';
  end if;
  if created ->> 'slug' <> 'rls-goods' then
    raise exception 'create_tenant slug mismatch';
  end if;
  if created ->> 'plan' <> 'free' then
    raise exception 'create_tenant plan is %', created ->> 'plan';
  end if;

  select count(*) into c from public.tenants where slug = 'rls-goods';
  if c <> 1 then raise exception 'owner cannot read the tenant they just created'; end if;

  select count(*) into c from public.tax_rates where tenant_id = (created ->> 'id')::uuid;
  if c < 5 then raise exception 'create_tenant did not seed GST rates (% )', c; end if;
end $$;

do $$
begin
  perform public.set_active_tenant('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1');
  raise exception 'set_active_tenant allowed a non-member';
exception
  when insufficient_privilege then
    null;
end $$;

-- Free plan cannot insert a product or a custom domain. Plan rows are not writable.
do $$
declare
  tid uuid;
  n int;
begin
  select id into tid from public.tenants where slug = 'rls-goods';
  begin
    insert into public.products (tenant_id, name, price, gst_rate)
    values (tid, 'Locked widget', 10, 0);
    raise exception 'free plan inserted a product';
  exception
    when insufficient_privilege then
      if sqlerrm not like '%FEATURE_LOCKED:product_catalog%' then
        raise exception 'product lock message was %', sqlerrm;
      end if;
  end;

  begin
    insert into public.tenant_domains (tenant_id, domain, verification_token)
    values (tid, 'locked.example.com', 'billflow-verify=test');
    raise exception 'free plan inserted a custom domain';
  exception
    when insufficient_privilege then
      if sqlerrm not like '%FEATURE_LOCKED:custom_domains%' then
        raise exception 'domain lock message was %', sqlerrm;
      end if;
  end;

  update public.tenant_subscriptions set status = 'active' where tenant_id = tid;
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'authenticated updated tenant_subscriptions';
  end if;
end $$;

reset role;
update public.tenant_subscriptions
set plan_id = '10000000-0000-4000-8000-000000000002',
    status = 'active',
    price_paise = 49900
where tenant_id = (select id from public.tenants where slug = 'rls-goods');

select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6', false);
select set_config('request.jwt.claim.role', 'authenticated', false);
set role authenticated;

do $$
declare
  created jsonb;
begin
  created := public.invite_member('friend@example.com', 'member');
  if created ->> 'kind' <> 'invitation' then
    raise exception 'expected an invitation, got %', created;
  end if;

  created := public.invite_member('owner-a@example.com', 'billing');
  if created ->> 'kind' <> 'membership' then
    raise exception 'expected a membership for an existing user, got %', created;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- anon: plans and the site RPC only
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claim.sub', '', false);
select set_config('request.jwt.claim.role', 'anon', false);
select set_config('request.jwt.claim.tenant_id', '', false);
set role anon;

do $$
declare c int;
begin
  select count(*) into c from public.plans;
  if c < 4 then raise exception 'anon saw % plans', c; end if;
end $$;

do $$
begin
  perform 1 from public.invoices;
  raise exception 'anon read invoices';
exception
  when insufficient_privilege then
    null;
end $$;

do $$
declare site jsonb;
begin
  site := public.get_site_by_host('acme');
  if site ->> 'slug' <> 'acme' then
    raise exception 'anon get_site_by_host(slug) failed: %', site;
  end if;
end $$;

reset role;

-- service_role bypasses RLS and can see every tenant's invoices.
set role service_role;

do $$
declare c int;
begin
  select count(*) into c from public.invoices;
  if c < 5 then
    raise exception 'service_role saw % invoices, expected the seed plus fixtures', c;
  end if;
end $$;

reset role;

-- Storefront tables stay closed to anon. The RPC is the only public read.
set role anon;

do $$
begin
  perform 1 from public.templates;
  raise exception 'anon read templates';
exception
  when insufficient_privilege then
    null;
end $$;

do $$
begin
  perform 1 from public.tenant_domains;
  raise exception 'anon read tenant_domains';
exception
  when insufficient_privilege then
    null;
end $$;

do $$
begin
  perform 1 from public.tenant_template_settings;
  raise exception 'anon read tenant_template_settings';
exception
  when insufficient_privilege then
    null;
end $$;

do $$
declare
  site jsonb;
begin
  site := public.get_site_by_host('acme.billflow.com');
  if site ->> 'slug' <> 'acme' or site ->> 'subdomain' <> 'acme' then
    raise exception 'published acme storefront missing: %', site;
  end if;
  if site::text ilike '%verification_token%' or site::text ilike '%seed-token%' then
    raise exception 'public site payload leaked a verification token';
  end if;
  if public.get_site_by_host('northwind.localhost') is not null then
    raise exception 'draft northwind storefront was public';
  end if;
  if (public.get_site_by_host('pay.saffronretail.in') ->> 'slug') <> 'saffron' then
    raise exception 'verified custom domain did not resolve';
  end if;
end $$;

reset role;

-- A member of tenant A cannot see tenant B's custom domains.
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', false);
select set_config('request.jwt.claim.role', 'authenticated', false);
set role authenticated;

do $$
declare
  c int;
begin
  select count(*) into c from public.tenant_domains;
  if c <> 0 then
    raise exception 'owner A saw % custom domains, expected none', c;
  end if;
end $$;

reset role;

set role anon;
do $$
declare
  site jsonb;
begin
  perform 1 from public.invoice_shares;
  raise exception 'anon read invoice_shares';
exception
  when insufficient_privilege then
    null;
end $$;

do $$
declare
  view jsonb;
begin
  view := public.get_shared_invoice('share-acme-inv-0002-public-token');
  if view ->> 'number' <> 'INV-0002' then
    raise exception 'shared invoice view failed: %', view;
  end if;
  if view::text ilike '%access_token%' then
    raise exception 'share view leaked a secret';
  end if;
  if public.get_shared_invoice('not-a-real-token-000000000000') is not null then
    raise exception 'unknown share token returned a row';
  end if;
end $$;
reset role;

-- Ledger tokens call extensions.gen_random_bytes, which is where hosted pgcrypto lives.
do $$
declare
  raw bytea;
  def text;
  minted text;
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'extensions' and p.proname = 'gen_random_bytes'
  ) then
    raise exception 'extensions.gen_random_bytes is missing';
  end if;
  raw := extensions.gen_random_bytes(24);
  if octet_length(raw) <> 24 then
    raise exception 'extensions.gen_random_bytes returned % bytes', octet_length(raw);
  end if;
  select pg_get_functiondef('public.create_customer_ledger_link(uuid)'::regprocedure) into def;
  if position('extensions.gen_random_bytes' in def) = 0 then
    raise exception 'ledger link does not call extensions.gen_random_bytes';
  end if;
  if position('gen_random_bytes(24)' in def) > 0
     and position('extensions.gen_random_bytes' in def) = 0 then
    raise exception 'ledger link still calls unqualified gen_random_bytes';
  end if;
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', false);
  perform set_config('request.jwt.claim.role', 'authenticated', false);
  minted := public.create_customer_ledger_link('cccccccc-cccc-4ccc-8ccc-ccccccccccc1') ->> 'token';
  if minted is null or char_length(minted) <> 48 then
    raise exception 'ledger token length was %', char_length(minted);
  end if;
  update public.customer_ledger_links as links set revoked_at = now() where links.token = minted;
end $$;

-- Offline sync is idempotent on client_id. The ledger token shows one customer.
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', false);
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.tenant_id', '', false);
set role authenticated;

do $$
declare
  created jsonb;
  replay jsonb;
  summary jsonb;
  events int;
begin
  created := public.sync_offline_sales(jsonb_build_array(jsonb_build_object(
    'client_id', '11111111-1111-4111-8111-111111111111',
    'customer_id', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
    'device_id', 'till-1',
    'lines', jsonb_build_array(jsonb_build_object(
      'description', 'Rice', 'quantity', 1, 'unit_price', 50, 'gst_rate', 0
    )),
    'payments', jsonb_build_array(jsonb_build_object(
      'client_id', '22222222-2222-4222-8222-222222222222',
      'method', 'cash', 'amount', 50, 'amount_tendered', 100, 'change_given', 50
    ))
  )));
  if created -> 0 ->> 'status' <> 'created' or created -> 0 ->> 'number' is null then
    raise exception 'sync did not create a numbered invoice: %', created;
  end if;

  replay := public.sync_offline_sales(jsonb_build_array(jsonb_build_object(
    'client_id', '11111111-1111-4111-8111-111111111111',
    'customer_id', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
    'lines', jsonb_build_array(jsonb_build_object(
      'description', 'Rice', 'quantity', 9, 'unit_price', 50, 'gst_rate', 0
    )),
    'payments', jsonb_build_array(jsonb_build_object(
      'client_id', '22222222-2222-4222-8222-222222222222',
      'method', 'cash', 'amount', 50
    ))
  )));
  if replay -> 0 ->> 'status' <> 'exists' or replay -> 0 ->> 'number' <> created -> 0 ->> 'number' then
    raise exception 'sync replay changed the invoice: % then %', created, replay;
  end if;
  if (select count(*) from public.invoices where client_id = '11111111-1111-4111-8111-111111111111') <> 1 then
    raise exception 'one client_id created more than one invoice';
  end if;
  if (select count(*) from public.payments where client_id = '22222222-2222-4222-8222-222222222222') <> 1 then
    raise exception 'one payment client_id was stored twice';
  end if;

  select count(*) into events from public.invoice_events
  where invoice_id = (created -> 0 ->> 'invoice_id')::uuid
    and kind in ('created', 'synced', 'payment_received');
  if events < 3 then
    raise exception 'timeline is missing sync events (% )', events;
  end if;

  summary := public.morning_summary();
  if jsonb_array_length(summary -> 'series_7d') <> 7 or jsonb_array_length(summary -> 'series_30d') <> 30 then
    raise exception 'morning series has the wrong length: %', summary;
  end if;
  if summary -> 'yesterday' -> 'sales' is null or summary -> 'top_dues' is null or summary -> 'low_stock' is null then
    raise exception 'morning summary is incomplete: %', summary;
  end if;

  perform set_config(
    'billflow.ledger_token',
    public.create_customer_ledger_link('cccccccc-cccc-4ccc-8ccc-ccccccccccc1') ->> 'token',
    false
  );
end $$;

reset role;
select set_config('request.jwt.claim.role', 'anon', false);
set role anon;

do $$
declare
  token text;
  ledger jsonb;
begin
  token := current_setting('billflow.ledger_token');
  ledger := public.get_customer_ledger(token);
  if ledger -> 'customer' ->> 'name' <> 'Customer A' then
    raise exception 'ledger customer was %', ledger -> 'customer' ->> 'name';
  end if;
  if ledger::text ilike '%Customer B%' then
    raise exception 'ledger leaked another customer';
  end if;
  if public.get_customer_ledger('not-a-ledger-token-000000000000') is not null then
    raise exception 'unknown ledger token returned data';
  end if;
end $$;

reset role;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', false);
select set_config('request.jwt.claim.role', 'authenticated', false);
set role authenticated;
do $$
declare
  token text;
begin
  token := current_setting('billflow.ledger_token');
  perform public.revoke_customer_ledger_link('cccccccc-cccc-4ccc-8ccc-ccccccccccc1');
  if public.get_customer_ledger(token) is not null then
    raise exception 'revoked ledger token still resolved';
  end if;
end $$;
reset role;

-- Purchases raise stock only when stock_tracking is on. Tiles group by category.
do $$
declare
  product uuid;
begin
  insert into public.products (tenant_id, name, price, gst_rate)
  values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'Dal', 40, 0)
  returning id into product;
  insert into public.tenant_feature_overrides (tenant_id, feature_key, enabled)
  values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'stock_tracking', true)
  on conflict (tenant_id, feature_key) do update set enabled = true;
  update public.products set stock = 10 where id = product;
  perform set_config('billflow.purchase_product', product::text, false);
end $$;

select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', false);
select set_config('request.jwt.claim.role', 'authenticated', false);
set role authenticated;

do $$
declare
  product uuid := current_setting('billflow.purchase_product')::uuid;
  category uuid;
  tiles jsonb;
  bought jsonb;
  on_hand numeric;
begin
  insert into public.product_categories (tenant_id, name, sort_order)
  values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'Grocery', 1)
  returning id into category;
  update public.products set category_id = category, is_favourite = true where id = product;

  tiles := public.pos_tiles(category);
  if jsonb_array_length(tiles -> 'categories') <> 1 or tiles -> 'categories' -> 0 ->> 'name' <> 'Grocery' then
    raise exception 'tiles were not grouped by category: %', tiles -> 'categories';
  end if;
  if jsonb_array_length(tiles -> 'favourites') <> 1 then
    raise exception 'category filter dropped the favourite';
  end if;

  bought := public.save_purchase(jsonb_build_object(
    'supplier', 'Northwind',
    'bill_date', '2026-11-20',
    'photo_ref', 'purchase-bills/dal.jpg',
    'lines', jsonb_build_array(jsonb_build_object(
      'product_id', product, 'description', 'Dal', 'quantity', 2, 'unit_price', 40, 'gst_rate', 5
    ))
  ));
  if bought ->> 'supplier' <> 'Northwind' or (bought ->> 'total')::numeric <> 84 then
    raise exception 'purchase total was %', bought;
  end if;
  if bought ->> 'photo_ref' <> 'purchase-bills/dal.jpg' then
    raise exception 'photo reference was not stored';
  end if;
  select p.stock into on_hand from public.products p where p.id = product;
  if on_hand <> 12 then
    raise exception 'stock did not increase, got %', on_hand;
  end if;
end $$;
reset role;

-- Platform admin is the seeded email only. Classic templates are free. Bold needs custom_templates.
insert into auth.users (id, email, raw_user_meta_data)
values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', 'maheshpatra920@gmail.com', '{"name":"Mahesh"}')
on conflict (id) do nothing;

do $$
declare
  catalog jsonb;
  promoted boolean;
begin
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', false);
  perform set_config('request.jwt.claim.role', 'authenticated', false);
  if public.is_platform_admin() then
    raise exception 'owner A must not be a platform admin';
  end if;
  begin
    perform public.admin_set_tenant_status('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'suspended');
    raise exception 'owner A suspended a tenant';
  exception
    when insufficient_privilege then
      null;
  end;

  perform set_config('request.jwt.claim.sub', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', false);
  promoted := public.claim_platform_admin();
  if not promoted or not public.is_platform_admin() then
    raise exception 'seeded email was not promoted';
  end if;
  perform public.admin_set_tenant_plan('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'growth');
  if (select plan from public.tenants where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1') <> 'growth' then
    raise exception 'admin plan change did not stick';
  end if;
  perform public.admin_set_tenant_status('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'active');
  if (select count(*) from public.audit_logs where action = 'tenant.plan' and entity_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1') < 1 then
    raise exception 'plan change was not audited';
  end if;

  -- A shop created before tenant_subscriptions existed has one open legacy
  -- subscription and no platform row. Changing the plan must reuse that row.
  insert into public.tenants (id, name, slug, plan, status)
  values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3', 'Legacy Shop', 'legacy-shop', 'starter', 'active');
  insert into public.subscriptions (
    id, tenant_id, plan_id, plan_name, price, currency, billing_cycle, status,
    start_date, current_period_start, current_period_end
  ) values (
    '66666666-6666-4666-8666-666666666661',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',
    (select id from public.plans where code = 'starter'),
    'Starter', 199, 'INR', 'monthly', 'active',
    current_date, current_date, current_date + 30
  );
  delete from public.tenant_subscriptions
  where tenant_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3';
  perform public.admin_set_tenant_plan('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3', 'business');
  if (select plan from public.tenants where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3') <> 'business' then
    raise exception 'legacy subscription plan change did not stick';
  end if;
  if (
    select count(*) from public.subscriptions
    where tenant_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3'
      and status in ('trialing', 'active', 'past_due', 'paused')
  ) <> 1 then
    raise exception 'plan change created a second open subscription';
  end if;
  if (
    select p.code
    from public.tenant_subscriptions ts
    join public.plans p on p.id = ts.plan_id
    where ts.tenant_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3'
      and ts.status in ('trialing', 'active', 'past_due', 'paused')
  ) <> 'business' then
    raise exception 'tenant subscription was not moved to business';
  end if;

  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', false);
  catalog := public.list_invoice_templates();
  if (select count(*) from jsonb_array_elements(catalog) item where item ->> 'key' = 'classic' and (item ->> 'entitled')::boolean) <> 1 then
    raise exception 'classic template is not entitled: %', catalog;
  end if;
  if (select count(*) from jsonb_array_elements(catalog) item where item ->> 'key' = 'bold' and (item ->> 'entitled')::boolean) <> 0 then
    raise exception 'bold template should be locked without custom_templates';
  end if;
  begin
    update public.tenants set default_template = 'bold' where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
    raise exception 'starter tenant selected a custom template';
  exception
    when insufficient_privilege then
      null;
  end;
end $$;

-- A shop owner cannot read or write the admin API, even through the security-definer functions.
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', false);
select set_config('request.jwt.claim.role', 'authenticated', false);
set role authenticated;
do $$
declare
  fn text;
begin
  if public.is_platform_admin() then
    raise exception 'owner A is a platform admin';
  end if;
  foreach fn in array array[
    'admin_list_plans()',
    'admin_list_templates()',
    'admin_list_tenants()',
    'admin_get_settings()'
  ]
  loop
    begin
      execute 'select public.' || fn;
      raise exception 'non-admin ran %', fn;
    exception
      when insufficient_privilege then
        null;
    end;
  end loop;
  begin
    perform public.admin_list_plan_features('free');
    raise exception 'non-admin listed plan features';
  exception
    when insufficient_privilege then
      null;
  end;
  begin
    perform public.admin_update_plan('free', '{"price_monthly": 1}'::jsonb);
    raise exception 'non-admin changed a price';
  exception
    when insufficient_privilege then
      null;
  end;
end $$;
reset role;

-- Supabase storage objects are writable only under the caller's tenant prefix.
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text,
  public boolean,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text,
  name text
);
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.objects to anon;
select public.ensure_billflow_storage();
do $$
begin
  if not exists (select 1 from storage.buckets where id = 'products' and public and file_size_limit = 2000000) then
    raise exception 'products bucket was not created';
  end if;
  if not exists (select 1 from storage.buckets where id = 'site-images' and public and file_size_limit = 2000000) then
    raise exception 'site-images bucket was not created';
  end if;
end $$;

select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', false);
select set_config('request.jwt.claim.role', 'authenticated', false);
set role authenticated;
insert into storage.objects (bucket_id, name)
values ('logos', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1/logo.png');
do $$
begin
  insert into storage.objects (bucket_id, name)
  values ('logos', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2/logo.png');
  raise exception 'wrote another tenant storage prefix';
exception
  when insufficient_privilege then
    null;
end $$;
reset role;

select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', false);
select set_config('request.jwt.claim.role', 'authenticated', false);
set role authenticated;
insert into storage.objects (bucket_id, name)
values
  ('products', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1/rice.webp'),
  ('site-images', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1/hero.jpg');
do $$
begin
  insert into storage.objects (bucket_id, name)
  values ('site-images', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2/hero.jpg');
  raise exception 'wrote another tenant site image';
exception
  when insufficient_privilege then
    null;
end $$;
reset role;

do $$
begin
  insert into public.products (tenant_id, name, price, gst_rate, image_url)
  values ('20000000-0000-4000-8000-000000000001', 'Bad image', 1, 0, 'http://cdn.example.com/rice.jpg');
  raise exception 'http product image was accepted';
exception
  when check_violation then
    null;
end $$;

insert into public.products (id, tenant_id, name, price, gst_rate, image_url)
values (
  '73000000-0000-4000-8000-000000000099',
  '20000000-0000-4000-8000-000000000001',
  'Shop photo rice',
  10,
  0,
  'https://cdn.example.com/rice.jpg'
)
on conflict (id) do update set image_url = excluded.image_url, name = excluded.name;

update public.tenant_template_settings
set published_overrides = coalesce(published_overrides, '{}'::jsonb) || jsonb_build_object(
  'hero_image_url', 'https://cdn.example.com/hero.jpg',
  'about_image_url', 'https://cdn.example.com/about.jpg'
)
where tenant_id = '20000000-0000-4000-8000-000000000001';

do $$
declare
  site jsonb;
  item jsonb;
begin
  site := public.get_site_by_host('acme.billflow.com');
  if site ->> 'hero_image_url' <> 'https://cdn.example.com/hero.jpg' then
    raise exception 'hero image missing: %', site ->> 'hero_image_url';
  end if;
  if site ->> 'about_image_url' <> 'https://cdn.example.com/about.jpg' then
    raise exception 'about image missing: %', site ->> 'about_image_url';
  end if;
  if (
    select count(*) from jsonb_array_elements(site -> 'products') p
    where p ->> 'name' = 'Shop photo rice' and p ->> 'image_url' = 'https://cdn.example.com/rice.jpg'
  ) <> 1 then
    raise exception 'public products omitted the image: %', site -> 'products';
  end if;
  if jsonb_array_length(site -> 'bestsellers') < 1 or jsonb_array_length(site -> 'bestsellers') > 6 then
    raise exception 'bestsellers length was %', jsonb_array_length(site -> 'bestsellers');
  end if;
  item := site -> 'bestsellers' -> 0;
  if not (item ? 'id' and item ? 'name' and item ? 'price' and item ? 'image_url') then
    raise exception 'bestseller shape was %', item;
  end if;
  if item::text ilike '%api_secret%' then
    raise exception 'shop payload leaked a secret';
  end if;
end $$;

do $$
begin
  update public.tenant_template_settings
  set overrides = coalesce(overrides, '{}'::jsonb) || '{"hero_image_url":"http://cdn.example.com/hero.jpg"}'::jsonb
  where tenant_id = '20000000-0000-4000-8000-000000000001';
  raise exception 'http hero was stored';
exception
  when invalid_parameter_value then
    null;
end $$;

set role anon;
do $$
begin
  perform public.shop_products('20000000-0000-4000-8000-000000000001');
  raise exception 'anon called shop_products';
exception
  when insufficient_privilege then
    null;
end $$;
reset role;

-- Cloudinary secret stays in the database. Signing matches the documented sha1.
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', false);
select set_config('request.jwt.claim.role', 'authenticated', false);
set role authenticated;
do $$
begin
  perform public.admin_set_cloudinary('{"api_secret":"fake-cloudinary-secret"}'::jsonb);
  raise exception 'owner saved a cloudinary secret';
exception
  when insufficient_privilege then
    null;
end $$;
reset role;
select set_config('request.jwt.claim.sub', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', false);
select set_config('request.jwt.claim.role', 'authenticated', false);
set role authenticated;
do $$
declare
  params text := 'folder=billflow/logos/t&public_id=file&timestamp=10';
  signed text;
  expected text;
  shown jsonb;
begin
  perform public.admin_set_cloudinary(jsonb_build_object(
    'cloud_name', 'fake-cloud',
    'api_key', 'fake-key',
    'api_secret', 'fake-cloudinary-secret'
  ));
  perform public.admin_set_cloudinary('{"api_secret":""}'::jsonb);
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', false);
  signed := public.cloudinary_sign(params);
  perform set_config('billflow.cloudinary_signed', signed, false);
  shown := public.cloudinary_public_config();
  if shown::text ilike '%fake-cloudinary-secret%' or shown ? 'api_secret' then
    raise exception 'cloudinary config returned the secret: %', shown;
  end if;
  if (shown ->> 'secret_set') <> 'true' or (shown ->> 'cloud_name') <> 'fake-cloud' then
    raise exception 'cloudinary public config was %', shown;
  end if;
end $$;
reset role;
do $$
declare
  params text := 'folder=billflow/logos/t&public_id=file&timestamp=10';
  expected text;
begin
  expected := encode(extensions.digest(params || 'fake-cloudinary-secret', 'sha1'), 'hex');
  if current_setting('billflow.cloudinary_signed') is distinct from expected then
    raise exception 'cloudinary signature mismatch';
  end if;
end $$;

do $$
begin
  raise notice 'RLS tests passed';
end $$;
