-- Hosted Supabase installs pgcrypto in the extensions schema.
-- create_customer_ledger_link set search_path = public, so gen_random_bytes was missing.

create schema if not exists extensions;

do $$
begin
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'extensions'
      and p.proname = 'gen_random_bytes'
  ) then
    execute $fn$
      create function extensions.gen_random_bytes(integer)
      returns bytea
      language sql
      stable
      as $body$ select public.gen_random_bytes($1) $body$
    $fn$;
  end if;
end $$;

create or replace function public.create_customer_ledger_link(p_customer uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  tid uuid := public.current_tenant_id();
  token text := encode(extensions.gen_random_bytes(24), 'hex');
  row public.customer_ledger_links;
begin
  if tid is null or not public.has_billing_access() then
    raise exception 'billing access is required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.customers c where c.id = p_customer and c.tenant_id = tid) then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;

  update public.customer_ledger_links
  set revoked_at = now()
  where customer_id = p_customer and revoked_at is null;

  insert into public.customer_ledger_links (tenant_id, customer_id, token, created_by)
  values (tid, p_customer, token, auth.uid())
  returning * into row;

  return jsonb_build_object(
    'token', row.token,
    'customer_id', row.customer_id,
    'created_at', row.created_at,
    'revoked_at', null
  );
end;
$$;

revoke all on function public.create_customer_ledger_link(uuid) from public, anon;
grant execute on function public.create_customer_ledger_link(uuid) to authenticated;
