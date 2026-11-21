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
