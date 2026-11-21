-- Cloudinary credentials saved by a platform admin.
-- The API secret is stored in Supabase Vault when that extension is installed.
-- Otherwise it is stored with pgcrypto in a locked table. No role can select it.
-- Signing happens in cloudinary_sign so the secret never returns to the API.

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

do $$
begin
  begin
    create extension if not exists supabase_vault;
  exception
    when others then
      raise notice 'supabase_vault is not installed (%). Using a locked pgcrypto store.', sqlerrm;
  end;
end $$;

create schema if not exists vault;

do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'vault' and p.proname = 'create_secret'
  ) then
    return;
  end if;

  create table if not exists vault.crypto_key (
    id integer primary key check (id = 1),
    key text not null
  );
  insert into vault.crypto_key (id, key)
  values (1, encode(extensions.gen_random_bytes(32), 'hex'))
  on conflict (id) do nothing;

  create table if not exists vault.secrets (
    id uuid primary key default gen_random_uuid(),
    name text,
    description text,
    secret_enc bytea not null,
    updated_at timestamptz not null default now()
  );

  execute $fn$
    create or replace function vault.create_secret(
      new_secret text,
      new_name text default null,
      new_description text default null,
      new_key_id uuid default null
    ) returns uuid
    language plpgsql
    security definer
    set search_path = vault, extensions, public
    as $body$
    declare
      new_id uuid;
      pass text;
    begin
      select key into pass from vault.crypto_key where id = 1;
      insert into vault.secrets (name, description, secret_enc)
      values (new_name, new_description, extensions.pgp_sym_encrypt(new_secret, pass))
      returning id into new_id;
      return new_id;
    end;
    $body$
  $fn$;

  execute $fn$
    create or replace function vault.update_secret(
      secret_id uuid,
      new_secret text default null,
      new_name text default null,
      new_description text default null,
      new_key_id uuid default null
    ) returns void
    language plpgsql
    security definer
    set search_path = vault, extensions, public
    as $body$
    declare
      pass text;
    begin
      select key into pass from vault.crypto_key where id = 1;
      update vault.secrets
      set secret_enc = extensions.pgp_sym_encrypt(coalesce(new_secret, ''), pass),
          name = coalesce(new_name, name),
          description = coalesce(new_description, description),
          updated_at = now()
      where id = secret_id;
    end;
    $body$
  $fn$;

  execute $fn$
    create or replace function vault.read_secret(secret_id uuid)
    returns text
    language plpgsql
    security definer
    set search_path = vault, extensions, public
    as $body$
    declare
      pass text;
      raw bytea;
    begin
      select key into pass from vault.crypto_key where id = 1;
      select secret_enc into raw from vault.secrets where id = secret_id;
      if raw is null then
        return null;
      end if;
      return extensions.pgp_sym_decrypt(raw, pass);
    end;
    $body$
  $fn$;
end $$;

revoke all on schema vault from public, anon, authenticated;
revoke all on all tables in schema vault from public, anon, authenticated, service_role;
revoke all on all functions in schema vault from public, anon, authenticated, service_role;

create table if not exists public.cloudinary_settings (
  id integer primary key check (id = 1),
  cloud_name text,
  api_key text,
  vault_secret_id uuid,
  updated_at timestamptz not null default now()
);

insert into public.cloudinary_settings (id) values (1) on conflict (id) do nothing;

alter table public.cloudinary_settings enable row level security;
revoke all on table public.cloudinary_settings from public, anon, authenticated, service_role;

create or replace function public.cloudinary_read_secret()
returns text
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  secret_id uuid;
  secret text;
begin
  select vault_secret_id into secret_id from public.cloudinary_settings where id = 1;
  if secret_id is null then
    return null;
  end if;
  if exists (
    select 1 from information_schema.views
    where table_schema = 'vault' and table_name = 'decrypted_secrets'
  ) then
    execute 'select decrypted_secret from vault.decrypted_secrets where id = $1'
      into secret using secret_id;
  else
    execute 'select vault.read_secret($1)' into secret using secret_id;
  end if;
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
set search_path = public, vault, extensions
as $$
declare
  row public.cloudinary_settings;
  secret text;
  new_id uuid;
begin
  perform public.assert_platform_admin();
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'cloudinary settings must be an object' using errcode = '22023';
  end if;
  insert into public.cloudinary_settings (id) values (1) on conflict (id) do nothing;
  select * into row from public.cloudinary_settings where id = 1 for update;

  if p_patch ? 'cloud_name' then
    row.cloud_name := nullif(btrim(coalesce(p_patch ->> 'cloud_name', '')), '');
  end if;
  if p_patch ? 'api_key' then
    row.api_key := nullif(btrim(coalesce(p_patch ->> 'api_key', '')), '');
  end if;
  if p_patch ? 'api_secret' and jsonb_typeof(p_patch -> 'api_secret') = 'string' and length(btrim(p_patch ->> 'api_secret')) > 0 then
    secret := p_patch ->> 'api_secret';
    if row.vault_secret_id is null then
      new_id := vault.create_secret(secret, 'billflow_cloudinary_api_secret', 'Cloudinary API secret');
      row.vault_secret_id := new_id;
    else
      perform vault.update_secret(row.vault_secret_id, secret);
    end if;
  elsif p_patch ? 'api_secret' and jsonb_typeof(p_patch -> 'api_secret') = 'null' then
    if row.vault_secret_id is not null then
      perform vault.update_secret(row.vault_secret_id, '');
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
