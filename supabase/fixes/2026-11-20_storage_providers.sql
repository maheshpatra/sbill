-- Standalone fix. Safe to re-run after 2026-11-20_admin_read_guard.sql.
-- Adds platform_settings.storage_provider and Supabase Storage buckets when the storage schema exists.

-- Selectable image storage. Supabase Storage buckets are created when the storage schema exists.

alter table public.platform_settings
  add column if not exists storage_provider text not null default 'supabase';

alter table public.platform_settings drop constraint if exists platform_settings_storage_provider;
alter table public.platform_settings
  add constraint platform_settings_storage_provider
  check (storage_provider in ('supabase', 'cloudinary', 'r2'));

create or replace function public.admin_update_settings(p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.platform_settings;
  next_provider text;
begin
  perform public.assert_platform_admin();
  next_provider := p_patch ->> 'storage_provider';
  if next_provider is not null and next_provider not in ('supabase', 'cloudinary', 'r2') then
    raise exception 'storage_provider must be supabase, cloudinary, or r2' using errcode = '22023';
  end if;
  update public.platform_settings
  set app_domain = coalesce(p_patch ->> 'app_domain', app_domain),
      dashboard_host = coalesce(p_patch ->> 'dashboard_host', dashboard_host),
      storage_provider = coalesce(next_provider, storage_provider)
  where id = 1
  returning * into row;
  perform public.platform_audit('settings.update', 'platform_settings', null, null, p_patch);
  return to_jsonb(row);
end;
$$;

revoke all on function public.admin_update_settings(jsonb) from public, anon;
grant execute on function public.admin_update_settings(jsonb) to authenticated;

create or replace function public.ensure_billflow_storage()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    return;
  end if;
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'storage' and table_name = 'buckets'
  ) then
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values
    ('logos', 'logos', true, 2000000, array['image/png', 'image/jpeg', 'image/webp']),
    ('avatars', 'avatars', true, 2000000, array['image/png', 'image/jpeg', 'image/webp']),
    ('bill-photos', 'bill-photos', false, 8000000, array['image/png', 'image/jpeg', 'image/webp', 'application/pdf']),
    ('invoice-pdfs', 'invoice-pdfs', false, 8000000, array['application/pdf'])
  on conflict (id) do update
    set public = excluded.public,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'storage' and table_name = 'objects'
  ) then
    return;
  end if;

  execute 'drop policy if exists billflow_storage_read on storage.objects';
  execute 'drop policy if exists billflow_storage_write on storage.objects';
  execute $policy$
    create policy billflow_storage_read on storage.objects
    for select to anon, authenticated
    using (bucket_id in ('logos', 'avatars'))
  $policy$;
  execute $policy$
    create policy billflow_storage_write on storage.objects
    for all to authenticated
    using (
      bucket_id in ('logos', 'avatars', 'bill-photos', 'invoice-pdfs')
      and split_part(name, '/', 1) = public.current_tenant_id()::text
    )
    with check (
      bucket_id in ('logos', 'avatars', 'bill-photos', 'invoice-pdfs')
      and split_part(name, '/', 1) = public.current_tenant_id()::text
    )
  $policy$;
end;
$$;

revoke all on function public.ensure_billflow_storage() from public, anon, authenticated;
select public.ensure_billflow_storage();
