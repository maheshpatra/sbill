-- Cloudinary credentials saved by a platform admin.
--
-- Hosted Supabase has supabase_vault, but the postgres role cannot call
-- pgsodium's _crypto_aead_det_encrypt. The previous script hit that error on
-- `revoke all on all tables/functions in schema vault` (vault.create_secret
-- exists, so the old shim was skipped and the revoke still touched Vault).
-- This script does not create, replace, or revoke anything in schema vault.
--
-- The API secret is stored with pgcrypto in schema billflow_private.
-- The encryption key is generated once in billflow_private.crypto_key.
-- No API role can read that schema. cloudinary_sign appends the secret in SQL.
-- Re-running is safe, including after the failed hosted attempt.

create schema if not exists extensions;

do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'extensions' and p.proname = 'digest'
  ) then
    execute $fn$
      create function extensions.digest(data text, type text)
      returns bytea language sql stable
      as $body$ select public.digest($1, $2) $body$
    $fn$;
  end if;
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'extensions' and p.proname = 'pgp_sym_encrypt'
  ) then
    execute $fn$
      create function extensions.pgp_sym_encrypt(data text, key text)
      returns bytea language sql volatile
      as $body$ select public.pgp_sym_encrypt($1, $2) $body$
    $fn$;
  end if;
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'extensions' and p.proname = 'pgp_sym_decrypt'
  ) then
    execute $fn$
      create function extensions.pgp_sym_decrypt(data bytea, key text)
      returns text language sql volatile
      as $body$ select public.pgp_sym_decrypt($1, $2) $body$
    $fn$;
  end if;
end $$;

-- Best-effort repair if the previous script revoked service_role on Vault.
-- Failure is ignored so a pgsodium event trigger cannot stop this script.
do $$
begin
  if to_regnamespace('vault') is null then
    return;
  end if;
  begin
    execute 'grant usage on schema vault to service_role';
  exception when others then
    raise notice 'vault usage grant left unchanged: %', sqlerrm;
  end;
  begin
    execute 'grant select, insert, update, delete on all tables in schema vault to service_role';
  exception when others then
    raise notice 'vault table grants left unchanged: %', sqlerrm;
  end;
  begin
    execute 'grant execute on all functions in schema vault to service_role';
  exception when others then
    raise notice 'vault function grants left unchanged: %', sqlerrm;
  end;
end $$;

create schema if not exists billflow_private;

revoke all on schema billflow_private from public, anon, authenticated, service_role;

create table if not exists billflow_private.crypto_key (
  id integer primary key check (id = 1),
  key text not null
);

insert into billflow_private.crypto_key (id, key)
select 1, encode(extensions.gen_random_bytes(32), 'hex')
where not exists (select 1 from billflow_private.crypto_key where id = 1);

create table if not exists billflow_private.secrets (
  id uuid primary key default gen_random_uuid(),
  name text,
  secret_enc bytea not null,
  updated_at timestamptz not null default now()
);

revoke all on all tables in schema billflow_private from public, anon, authenticated, service_role;

create table if not exists public.cloudinary_settings (
  id integer primary key check (id = 1),
  cloud_name text,
  api_key text,
  vault_secret_id uuid,
  updated_at timestamptz not null default now()
);

alter table public.cloudinary_settings
  add column if not exists cloud_name text,
  add column if not exists api_key text,
  add column if not exists vault_secret_id uuid,
  add column if not exists updated_at timestamptz not null default now();

insert into public.cloudinary_settings (id) values (1) on conflict (id) do nothing;

alter table public.cloudinary_settings enable row level security;
revoke all on table public.cloudinary_settings from public, anon, authenticated, service_role;

create or replace function public.cloudinary_read_secret()
returns text
language plpgsql
security definer
set search_path = public, billflow_private, extensions
as $$
declare
  secret_id uuid;
  pass text;
  raw bytea;
  secret text;
begin
  select vault_secret_id into secret_id from public.cloudinary_settings where id = 1;
  if secret_id is null then
    return null;
  end if;
  select key into pass from billflow_private.crypto_key where id = 1;
  select secret_enc into raw from billflow_private.secrets where id = secret_id;
  if raw is null or pass is null then
    return null;
  end if;
  secret := extensions.pgp_sym_decrypt(raw, pass);
  if secret is null or secret = '' then
    return null;
  end if;
  return secret;
end;
$$;

create or replace function public.cloudinary_public_config()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.cloudinary_settings;
  secret text;
begin
  if public.current_tenant_id() is null and not public.is_platform_admin() then
    raise exception 'an active tenant is required' using errcode = '42501';
  end if;
  select * into row from public.cloudinary_settings where id = 1;
  secret := public.cloudinary_read_secret();
  return jsonb_build_object(
    'cloud_name', row.cloud_name,
    'api_key', row.api_key,
    'secret_set', secret is not null
  );
end;
$$;

create or replace function public.cloudinary_sign(p_params_to_sign text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  secret text;
begin
  if auth.uid() is null or public.current_tenant_id() is null then
    raise exception 'an active tenant is required' using errcode = '42501';
  end if;
  if p_params_to_sign is null or btrim(p_params_to_sign) = '' then
    raise exception 'params to sign are required' using errcode = '22023';
  end if;
  secret := public.cloudinary_read_secret();
  if secret is null then
    raise exception 'cloudinary is not configured' using errcode = '22023';
  end if;
  return encode(extensions.digest(p_params_to_sign || secret, 'sha1'), 'hex');
end;
$$;

create or replace function public.admin_set_cloudinary(p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, billflow_private, extensions
as $$
declare
  row public.cloudinary_settings;
  secret text;
  pass text;
  new_id uuid;
begin
  perform public.assert_platform_admin();
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'cloudinary settings must be an object' using errcode = '22023';
  end if;
  insert into public.cloudinary_settings (id) values (1) on conflict (id) do nothing;
  select * into row from public.cloudinary_settings where id = 1 for update;
  select key into pass from billflow_private.crypto_key where id = 1;
  if pass is null then
    raise exception 'cloudinary secret key is missing' using errcode = '22023';
  end if;

  if p_patch ? 'cloud_name' then
    row.cloud_name := nullif(btrim(coalesce(p_patch ->> 'cloud_name', '')), '');
  end if;
  if p_patch ? 'api_key' then
    row.api_key := nullif(btrim(coalesce(p_patch ->> 'api_key', '')), '');
  end if;
  if p_patch ? 'api_secret' and jsonb_typeof(p_patch -> 'api_secret') = 'string' and length(btrim(p_patch ->> 'api_secret')) > 0 then
    secret := p_patch ->> 'api_secret';
    if row.vault_secret_id is null or not exists (
      select 1 from billflow_private.secrets s where s.id = row.vault_secret_id
    ) then
      insert into billflow_private.secrets (name, secret_enc)
      values ('billflow_cloudinary_api_secret', extensions.pgp_sym_encrypt(secret, pass))
      returning id into new_id;
      row.vault_secret_id := new_id;
    else
      update billflow_private.secrets
      set secret_enc = extensions.pgp_sym_encrypt(secret, pass),
          updated_at = now()
      where id = row.vault_secret_id;
    end if;
  elsif p_patch ? 'api_secret' and jsonb_typeof(p_patch -> 'api_secret') = 'null' then
    if row.vault_secret_id is not null then
      update billflow_private.secrets
      set secret_enc = extensions.pgp_sym_encrypt('', pass),
          updated_at = now()
      where id = row.vault_secret_id;
    end if;
    row.vault_secret_id := null;
  end if;

  update public.cloudinary_settings
  set cloud_name = row.cloud_name,
      api_key = row.api_key,
      vault_secret_id = row.vault_secret_id,
      updated_at = now()
  where id = 1;

  perform public.platform_audit('cloudinary.update', 'cloudinary_settings', null, null, jsonb_build_object(
    'cloud_name_set', row.cloud_name is not null,
    'api_key_set', row.api_key is not null,
    'secret_updated', p_patch ? 'api_secret' and jsonb_typeof(p_patch -> 'api_secret') = 'string' and length(btrim(coalesce(p_patch ->> 'api_secret', ''))) > 0,
    'secret_cleared', p_patch ? 'api_secret' and jsonb_typeof(p_patch -> 'api_secret') = 'null'
  ));
  return public.cloudinary_public_config();
end;
$$;

revoke all on function public.cloudinary_read_secret() from public, anon, authenticated, service_role;
revoke all on function public.cloudinary_public_config() from public, anon;
revoke all on function public.cloudinary_sign(text) from public, anon;
revoke all on function public.admin_set_cloudinary(jsonb) from public, anon;

grant execute on function public.cloudinary_public_config() to authenticated;
grant execute on function public.cloudinary_sign(text) to authenticated;
grant execute on function public.admin_set_cloudinary(jsonb) to authenticated;
