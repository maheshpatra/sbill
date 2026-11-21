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
