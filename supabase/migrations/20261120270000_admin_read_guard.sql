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
