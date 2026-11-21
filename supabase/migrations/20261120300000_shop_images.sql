-- Shop photos: product images, public product and site buckets, and website hero/about URLs.
-- Re-running is safe. https is required. Bestsellers are the last 30 days, else the newest products.

alter table public.products
  add column if not exists image_url text;

alter table public.products drop constraint if exists products_image_url_https;
alter table public.products
  add constraint products_image_url_https
  check (image_url is null or image_url ~* '^https://\S+$');

create or replace function public.https_or_null(p_value text)
returns text
language sql
immutable
as $$
  select case
    when p_value is null or btrim(p_value) = '' then null
    when btrim(p_value) ~* '^https://\S+$' then btrim(p_value)
    else null
  end
$$;

create or replace function public.assert_https_site_images()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  key text;
  value text;
begin
  foreach key in array array['hero_image_url', 'about_image_url']
  loop
    value := nullif(btrim(coalesce(new.overrides ->> key, '')), '');
    if value is not null and value !~* '^https://\S+$' then
      raise exception '% must be an https URL', key using errcode = '22023';
    end if;
    value := nullif(btrim(coalesce(new.published_overrides ->> key, '')), '');
    if value is not null and value !~* '^https://\S+$' then
      raise exception '% must be an https URL', key using errcode = '22023';
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists tenant_template_settings_https_images on public.tenant_template_settings;
create trigger tenant_template_settings_https_images
  before insert or update of overrides, published_overrides on public.tenant_template_settings
  for each row execute function public.assert_https_site_images();

create or replace function public.shop_products(p_tenant uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'price', p.price,
    'image_url', p.image_url
  ) order by p.name), '[]'::jsonb)
  from public.products p
  where p.tenant_id = p_tenant and p.active
$$;

create or replace function public.shop_bestsellers(p_tenant uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ranked.id,
    'name', ranked.name,
    'price', ranked.price,
    'image_url', ranked.image_url
  ) order by ranked.sold_qty desc, ranked.name), '[]'::jsonb)
    into result
  from (
    select p.id, p.name, p.price, p.image_url, sum(it.quantity) as sold_qty
    from public.invoice_items it
    join public.invoices i on i.id = it.invoice_id
    join public.products p
      on p.tenant_id = p_tenant
     and p.active
     and (
       p.id = it.product_id
       or (it.product_id is null and lower(p.name) = lower(it.description))
     )
    where i.tenant_id = p_tenant
      and i.status <> 'void'
      and i.created_at > now() - interval '30 days'
    group by p.id, p.name, p.price, p.image_url
    order by sold_qty desc, p.name
    limit 6
  ) ranked;

  if result is null or result = '[]'::jsonb then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', newest.id,
      'name', newest.name,
      'price', newest.price,
      'image_url', newest.image_url
    ) order by newest.created_at desc), '[]'::jsonb)
      into result
    from (
      select p.id, p.name, p.price, p.image_url, p.created_at
      from public.products p
      where p.tenant_id = p_tenant and p.active
      order by p.created_at desc
      limit 6
    ) newest;
  end if;
  return coalesce(result, '[]'::jsonb);
end;
$$;

create or replace function public.get_site_by_host(p_host text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  h text := lower(rtrim(split_part(coalesce(p_host, ''), ':', 1), '.'));
  app_domain text;
  tid uuid;
  sub text;
  tname text;
  logo text;
  currency text;
  slug text;
  via_custom boolean;
  tmpl_slug text;
  tmpl_name text;
  base_config jsonb;
  published jsonb;
  published_at timestamptz;
  legacy_title text;
  legacy_tagline text;
  legacy_about text;
  legacy_published boolean;
  site jsonb;
begin
  if h = '' then
    return null;
  end if;

  select s.app_domain into app_domain from public.platform_settings s where s.id = 1;
  app_domain := lower(coalesce(app_domain, 'billflow.com'));

  select t.id, coalesce(t.subdomain, t.slug), t.slug, t.name, t.logo_url, t.currency,
         (d.id is not null or site_row.id is not null)
    into tid, sub, slug, tname, logo, currency, via_custom
  from public.tenants t
  left join public.tenant_domains d
    on d.tenant_id = t.id and d.verified and lower(d.domain) = h
  left join public.sites site_row
    on site_row.tenant_id = t.id and lower(site_row.custom_domain) = h
  where d.id is not null
     or site_row.id is not null
     or lower(coalesce(t.subdomain, t.slug)) = h
     or lower(coalesce(t.subdomain, t.slug)) || '.' || app_domain = h
     or lower(coalesce(t.subdomain, t.slug)) || '.localhost' = h
  order by case when d.id is not null or site_row.id is not null then 0 else 1 end
  limit 1;

  if tid is null then
    return null;
  end if;
  if via_custom and not public.has_feature(tid, 'custom_domains') then
    return null;
  end if;

  select ts.published_overrides, ts.published_at, tmpl.config, tmpl.slug, tmpl.name
    into published, published_at, base_config, tmpl_slug, tmpl_name
  from public.tenant_template_settings ts
  join public.templates tmpl on tmpl.id = ts.template_id
  where ts.tenant_id = tid
    and ts.published_at is not null;

  if published_at is not null then
    published := coalesce(published, '{}'::jsonb);
    base_config := coalesce(base_config, '{}'::jsonb);
    if tmpl_slug is distinct from 'classic' and not public.has_feature(tid, 'custom_templates') then
      select tmpl.config, tmpl.slug, tmpl.name
        into base_config, tmpl_slug, tmpl_name
      from public.templates tmpl
      where tmpl.slug = 'classic';
      published := published - 'colors' - 'fonts' - 'layout' - 'sections';
    end if;
    site := jsonb_build_object(
      'tenant_id', tid,
      'slug', slug,
      'subdomain', sub,
      'name', tname,
      'title', coalesce(published ->> 'title', tname),
      'tagline', published ->> 'tagline',
      'about', published ->> 'about',
      'logo_url', coalesce(published ->> 'logo_url', logo),
      'hero_image_url', public.https_or_null(published ->> 'hero_image_url'),
      'about_image_url', public.https_or_null(published ->> 'about_image_url'),
      'published', true,
      'host', h,
      'currency', currency,
      'template', jsonb_build_object('slug', tmpl_slug, 'name', tmpl_name),
      'config', jsonb_build_object(
        'colors', coalesce(base_config -> 'colors', '{}'::jsonb) || coalesce(published -> 'colors', '{}'::jsonb),
        'fonts', coalesce(base_config -> 'fonts', '{}'::jsonb) || coalesce(published -> 'fonts', '{}'::jsonb),
        'layout', coalesce(base_config -> 'layout', '{}'::jsonb) || coalesce(published -> 'layout', '{}'::jsonb),
        'sections', case
          when jsonb_typeof(published -> 'sections') = 'array' then published -> 'sections'
          else coalesce(base_config -> 'sections', '[]'::jsonb)
        end
      ),
      'products', public.shop_products(tid),
      'bestsellers', public.shop_bestsellers(tid)
    );
    return site;
  end if;

  select site_row.title, site_row.tagline, site_row.about, site_row.published
    into legacy_title, legacy_tagline, legacy_about, legacy_published
  from public.sites site_row
  where site_row.tenant_id = tid;

  if coalesce(legacy_published, false) = false then
    return null;
  end if;

  return jsonb_build_object(
    'tenant_id', tid,
    'slug', slug,
    'subdomain', sub,
    'name', tname,
    'title', coalesce(legacy_title, tname),
    'tagline', legacy_tagline,
    'about', legacy_about,
    'logo_url', logo,
    'hero_image_url', null,
    'about_image_url', null,
    'published', true,
    'host', h,
    'currency', currency,
    'template', jsonb_build_object('slug', 'classic', 'name', 'Classic'),
    'config', '{}'::jsonb,
    'products', public.shop_products(tid),
    'bestsellers', public.shop_bestsellers(tid)
  );
end;
$$;

revoke all on function public.https_or_null(text) from public, anon, authenticated;
revoke all on function public.assert_https_site_images() from public, anon, authenticated;
revoke all on function public.shop_products(uuid) from public, anon, authenticated;
revoke all on function public.shop_bestsellers(uuid) from public, anon, authenticated;
revoke all on function public.get_site_by_host(text) from public;
grant execute on function public.get_site_by_host(text) to anon, authenticated, service_role;

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
    ('products', 'products', true, 2000000, array['image/png', 'image/jpeg', 'image/webp']),
    ('site-images', 'site-images', true, 2000000, array['image/png', 'image/jpeg', 'image/webp']),
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
    using (bucket_id in ('logos', 'avatars', 'products', 'site-images'))
  $policy$;
  execute $policy$
    create policy billflow_storage_write on storage.objects
    for all to authenticated
    using (
      bucket_id in ('logos', 'avatars', 'products', 'site-images', 'bill-photos', 'invoice-pdfs')
      and split_part(name, '/', 1) = public.current_tenant_id()::text
    )
    with check (
      bucket_id in ('logos', 'avatars', 'products', 'site-images', 'bill-photos', 'invoice-pdfs')
      and split_part(name, '/', 1) = public.current_tenant_id()::text
    )
  $policy$;
end;
$$;

revoke all on function public.ensure_billflow_storage() from public, anon, authenticated;
select public.ensure_billflow_storage();
