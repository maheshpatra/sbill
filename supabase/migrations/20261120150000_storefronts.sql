-- Billflow migration 6
-- Public storefronts: subdomain, custom domains, templates.
-- Anonymous visitors cannot read these tables. They use get_site_by_host().

alter table public.tenants
  add column if not exists subdomain text;

alter table public.tenants
  drop constraint if exists tenants_subdomain_format;

alter table public.tenants
  add constraint tenants_subdomain_format check (
    subdomain is null
    or (
      subdomain ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
      and subdomain <> all (array[
        'www', 'app', 'api', 'admin', 'dashboard', 'mail', 'billing', 'static',
        'auth', 'sites', 'status', 'cdn', 'ftp', 'smtp', 'imap', 'pop',
        'ns1', 'ns2', 'support', 'help', 'blog', 'root'
      ])
    )
  );

create unique index if not exists tenants_subdomain_unique
  on public.tenants (subdomain)
  where subdomain is not null;

update public.tenants
   set subdomain = slug
 where subdomain is null
   and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
   and slug <> all (array[
     'www', 'app', 'api', 'admin', 'dashboard', 'mail', 'billing', 'static',
     'auth', 'sites', 'status', 'cdn', 'ftp', 'smtp', 'imap', 'pop',
     'ns1', 'ns2', 'support', 'help', 'blog', 'root'
   ]);

update public.platform_settings
   set app_domain = 'billflow.com',
       dashboard_host = 'app.billflow.com'
 where id = 1;

-- ---------------------------------------------------------------------------
-- Catalog and per-tenant settings
-- ---------------------------------------------------------------------------

create table if not exists public.templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text not null default '',
  config jsonb not null default '{}'::jsonb,
  preview_image_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint templates_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

insert into public.templates (id, name, slug, description, preview_image_url, config) values
  (
    '71000000-0000-4000-8000-000000000001',
    'Classic',
    'classic',
    'A centered shopfront with a cream page and a clear list of services.',
    '/templates/classic.svg',
    jsonb_build_object(
      'colors', jsonb_build_object('background', '#faf7f2', 'text', '#1c1917', 'accent', '#0f766e', 'muted', '#78716c'),
      'fonts', jsonb_build_object('heading', 'Georgia', 'body', 'Outfit'),
      'layout', jsonb_build_object('hero', 'center', 'nav', 'top'),
      'sections', jsonb_build_array(
        jsonb_build_object('id', 'hero', 'enabled', true, 'title', 'Welcome', 'body', 'Tell customers what you do.'),
        jsonb_build_object('id', 'services', 'enabled', true, 'title', 'Services', 'body', 'What you can hire us for.'),
        jsonb_build_object('id', 'contact', 'enabled', true, 'title', 'Contact', 'body', 'How to reach the shop.')
      )
    )
  ),
  (
    '71000000-0000-4000-8000-000000000002',
    'Modern',
    'modern',
    'Split hero, navy type, and an emerald accent. Built for a studio or agency.',
    '/templates/modern.svg',
    jsonb_build_object(
      'colors', jsonb_build_object('background', '#f8fafc', 'text', '#0f172a', 'accent', '#10b981', 'muted', '#64748b'),
      'fonts', jsonb_build_object('heading', 'Outfit', 'body', 'Outfit'),
      'layout', jsonb_build_object('hero', 'split', 'nav', 'top'),
      'sections', jsonb_build_array(
        jsonb_build_object('id', 'hero', 'enabled', true, 'title', 'Work with us', 'body', 'A short line about the business.'),
        jsonb_build_object('id', 'services', 'enabled', true, 'title', 'What we offer', 'body', 'Three things clients book most.'),
        jsonb_build_object('id', 'contact', 'enabled', true, 'title', 'Start a project', 'body', 'Email or pay by UPI.')
      )
    )
  ),
  (
    '71000000-0000-4000-8000-000000000003',
    'Minimal',
    'minimal',
    'Mostly type, lots of space, one accent color.',
    '/templates/minimal.svg',
    jsonb_build_object(
      'colors', jsonb_build_object('background', '#ffffff', 'text', '#111111', 'accent', '#14b8a6', 'muted', '#6b7280'),
      'fonts', jsonb_build_object('heading', 'Outfit', 'body', 'Outfit'),
      'layout', jsonb_build_object('hero', 'center', 'nav', 'top'),
      'sections', jsonb_build_array(
        jsonb_build_object('id', 'hero', 'enabled', true, 'title', 'Hello', 'body', 'One sentence is enough.'),
        jsonb_build_object('id', 'services', 'enabled', false, 'title', 'Services', 'body', ''),
        jsonb_build_object('id', 'contact', 'enabled', true, 'title', 'Write to us', 'body', '')
      )
    )
  )
on conflict (slug) do update
  set name = excluded.name,
      description = excluded.description,
      preview_image_url = excluded.preview_image_url,
      config = excluded.config,
      is_active = true;

create table if not exists public.tenant_template_settings (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  template_id uuid not null references public.templates (id),
  overrides jsonb not null default '{}'::jsonb,
  published_overrides jsonb,
  published_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.tenant_domains (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  domain text not null,
  verified boolean not null default false,
  verification_token text not null,
  ssl_status text not null default 'pending' check (ssl_status in ('pending', 'issuing', 'active', 'failed')),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_domains_format check (domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$')
);

create unique index if not exists tenant_domains_domain_unique
  on public.tenant_domains (lower(domain));

create unique index if not exists tenant_domains_one_primary
  on public.tenant_domains (tenant_id)
  where is_primary;

drop trigger if exists templates_set_updated_at on public.templates;
create trigger templates_set_updated_at
  before update on public.templates
  for each row execute function public.set_updated_at();

drop trigger if exists tenant_template_settings_set_updated_at on public.tenant_template_settings;
create trigger tenant_template_settings_set_updated_at
  before update on public.tenant_template_settings
  for each row execute function public.set_updated_at();

drop trigger if exists tenant_domains_set_updated_at on public.tenant_domains;
create trigger tenant_domains_set_updated_at
  before update on public.tenant_domains
  for each row execute function public.set_updated_at();

create or replace function public.assign_default_storefront()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  classic uuid;
begin
  if new.subdomain is null then
    new.subdomain := new.slug;
  end if;

  select id into classic from public.templates where slug = 'classic';
  if classic is not null then
    insert into public.tenant_template_settings (tenant_id, template_id)
    values (new.id, classic)
    on conflict (tenant_id) do nothing;
  end if;
  return new;
end;
$$;

-- subdomain default must run BEFORE insert so the row satisfies the check.
drop trigger if exists tenants_assign_storefront on public.tenants;
create trigger tenants_assign_storefront
  before insert on public.tenants
  for each row execute function public.assign_default_storefront();

-- The settings insert inside a BEFORE trigger cannot see new.id as a committed
-- row. Do the settings insert AFTER insert instead.
create or replace function public.assign_default_storefront()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.subdomain is null then
    new.subdomain := new.slug;
  end if;
  return new;
end;
$$;

create or replace function public.seed_default_storefront()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  classic uuid;
begin
  select id into classic from public.templates where slug = 'classic';
  if classic is not null then
    insert into public.tenant_template_settings (tenant_id, template_id)
    values (new.id, classic)
    on conflict (tenant_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists tenants_seed_storefront on public.tenants;
create trigger tenants_seed_storefront
  after insert on public.tenants
  for each row execute function public.seed_default_storefront();

-- ---------------------------------------------------------------------------
-- Public lookup. Published storefronts only. No tokens, no drafts.
-- ---------------------------------------------------------------------------

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
  tmpl_slug text;
  tmpl_name text;
  base_config jsonb;
  published jsonb;
  published_at timestamptz;
  colors jsonb;
  fonts jsonb;
  layout jsonb;
  sections jsonb;
begin
  if h = '' then
    return null;
  end if;

  select s.app_domain into app_domain from public.platform_settings s where s.id = 1;
  app_domain := lower(coalesce(app_domain, 'billflow.com'));

  select t.id, coalesce(t.subdomain, t.slug), t.slug, t.name, t.logo_url, t.currency
    into tid, sub, slug, tname, logo, currency
  from public.tenants t
  left join public.tenant_domains d
    on d.tenant_id = t.id
   and d.verified
   and lower(d.domain) = h
  left join public.sites site
    on site.tenant_id = t.id
   and lower(site.custom_domain) = h
  where d.id is not null
     or site.id is not null
     or lower(coalesce(t.subdomain, t.slug)) = h
     or lower(coalesce(t.subdomain, t.slug)) || '.' || app_domain = h
     or lower(coalesce(t.subdomain, t.slug)) || '.localhost' = h
  order by case when d.id is not null or site.id is not null then 0 else 1 end
  limit 1;

  if tid is null then
    return null;
  end if;

  select ts.published_overrides, ts.published_at, tmpl.config, tmpl.slug, tmpl.name
    into published, published_at, base_config, tmpl_slug, tmpl_name
  from public.tenant_template_settings ts
  join public.templates tmpl on tmpl.id = ts.template_id
  where ts.tenant_id = tid
    and ts.published_at is not null;

  if published_at is null then
    -- Legacy published flag, still without private columns.
    if not exists (
      select 1 from public.sites site
      where site.tenant_id = tid and site.published
    ) then
      return null;
    end if;
    return (
      select jsonb_build_object(
        'tenant_id', tid,
        'slug', slug,
        'subdomain', sub,
        'name', tname,
        'title', site.title,
        'tagline', site.tagline,
        'about', site.about,
        'logo_url', coalesce(tname.logo, logo),
        'published', true,
        'host', h,
        'currency', currency,
        'template', jsonb_build_object('slug', 'classic', 'name', 'Classic'),
        'config', coalesce(site.theme, '{}'::jsonb)
      )
      from public.sites site
      left join public.tenants tname on false
      where site.tenant_id = tid
    );
  end if;

  published := coalesce(published, '{}'::jsonb);
  base_config := coalesce(base_config, '{}'::jsonb);
  colors := coalesce(base_config -> 'colors', '{}'::jsonb) || coalesce(published -> 'colors', '{}'::jsonb);
  fonts := coalesce(base_config -> 'fonts', '{}'::jsonb) || coalesce(published -> 'fonts', '{}'::jsonb);
  layout := coalesce(base_config -> 'layout', '{}'::jsonb) || coalesce(published -> 'layout', '{}'::jsonb);
  sections := case
    when jsonb_typeof(published -> 'sections') = 'array' then published -> 'sections'
    else coalesce(base_config -> 'sections', '[]'::jsonb)
  end;

  return jsonb_build_object(
    'tenant_id', tid,
    'slug', slug,
    'subdomain', sub,
    'name', tname,
    'title', coalesce(published ->> 'title', tname),
    'tagline', published ->> 'tagline',
    'about', published ->> 'about',
    'logo_url', coalesce(published ->> 'logo_url', logo),
    'published', true,
    'host', h,
    'currency', currency,
    'template', jsonb_build_object('slug', tmpl_slug, 'name', tmpl_name),
    'config', jsonb_build_object(
      'colors', colors,
      'fonts', fonts,
      'layout', layout,
      'sections', sections
    )
  );
end;
$$;

-- The legacy branch above references a bogus join. Replace with a clean function.
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
  tmpl_slug text;
  tmpl_name text;
  base_config jsonb;
  published jsonb;
  published_at timestamptz;
  legacy_title text;
  legacy_tagline text;
  legacy_about text;
  legacy_published boolean;
begin
  if h = '' then
    return null;
  end if;

  select s.app_domain into app_domain from public.platform_settings s where s.id = 1;
  app_domain := lower(coalesce(app_domain, 'billflow.com'));

  select t.id, coalesce(t.subdomain, t.slug), t.slug, t.name, t.logo_url, t.currency
    into tid, sub, slug, tname, logo, currency
  from public.tenants t
  left join public.tenant_domains d
    on d.tenant_id = t.id and d.verified and lower(d.domain) = h
  left join public.sites site
    on site.tenant_id = t.id and lower(site.custom_domain) = h
  where d.id is not null
     or site.id is not null
     or lower(coalesce(t.subdomain, t.slug)) = h
     or lower(coalesce(t.subdomain, t.slug)) || '.' || app_domain = h
     or lower(coalesce(t.subdomain, t.slug)) || '.localhost' = h
  order by case when d.id is not null or site.id is not null then 0 else 1 end
  limit 1;

  if tid is null then
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
    return jsonb_build_object(
      'tenant_id', tid,
      'slug', slug,
      'subdomain', sub,
      'name', tname,
      'title', coalesce(published ->> 'title', tname),
      'tagline', published ->> 'tagline',
      'about', published ->> 'about',
      'logo_url', coalesce(published ->> 'logo_url', logo),
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
      )
    );
  end if;

  select site.title, site.tagline, site.about, site.published
    into legacy_title, legacy_tagline, legacy_about, legacy_published
  from public.sites site
  where site.tenant_id = tid;

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
    'published', true,
    'host', h,
    'currency', currency,
    'template', jsonb_build_object('slug', 'classic', 'name', 'Classic'),
    'config', '{}'::jsonb
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS. Anon has no table privileges here.
-- ---------------------------------------------------------------------------

alter table public.templates enable row level security;
alter table public.tenant_template_settings enable row level security;
alter table public.tenant_domains enable row level security;

drop policy if exists templates_select on public.templates;
create policy templates_select
  on public.templates
  for select
  to authenticated
  using (is_active);

drop policy if exists storefront_select on public.tenant_template_settings;
create policy storefront_select
  on public.tenant_template_settings
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists storefront_write on public.tenant_template_settings;
create policy storefront_write
  on public.tenant_template_settings
  for all
  to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_admin_access())
  with check (tenant_id = public.current_tenant_id() and public.has_admin_access());

drop policy if exists domains_all on public.tenant_domains;
create policy domains_all
  on public.tenant_domains
  for all
  to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_admin_access())
  with check (tenant_id = public.current_tenant_id() and public.has_admin_access());

grant select on public.templates to authenticated;
grant select, insert, update, delete on public.tenant_template_settings to authenticated;
grant select, insert, update, delete on public.tenant_domains to authenticated;
grant all privileges on public.templates, public.tenant_template_settings, public.tenant_domains to service_role;

revoke all on function public.get_site_by_host(text) from public, anon, authenticated;
grant execute on function public.get_site_by_host(text) to anon, authenticated, service_role;
revoke all on function public.assign_default_storefront() from public, anon, authenticated;
revoke all on function public.seed_default_storefront() from public, anon, authenticated;

-- Storage bucket. Present on hosted Supabase, absent in the local stub.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
    values ('tenant-assets', 'tenant-assets', true)
    on conflict (id) do nothing;

    execute 'drop policy if exists tenant_assets_public_read on storage.objects';
    execute 'drop policy if exists tenant_assets_insert on storage.objects';
    execute 'drop policy if exists tenant_assets_update on storage.objects';
    execute 'drop policy if exists tenant_assets_delete on storage.objects';

    execute $pol$
      create policy tenant_assets_public_read on storage.objects
        for select to anon, authenticated
        using (bucket_id = 'tenant-assets')
    $pol$;
    execute $pol$
      create policy tenant_assets_insert on storage.objects
        for insert to authenticated
        with check (
          bucket_id = 'tenant-assets'
          and (storage.foldername(name))[1] = public.current_tenant_id()::text
          and public.has_admin_access()
        )
    $pol$;
    execute $pol$
      create policy tenant_assets_update on storage.objects
        for update to authenticated
        using (
          bucket_id = 'tenant-assets'
          and (storage.foldername(name))[1] = public.current_tenant_id()::text
          and public.has_admin_access()
        )
    $pol$;
    execute $pol$
      create policy tenant_assets_delete on storage.objects
        for delete to authenticated
        using (
          bucket_id = 'tenant-assets'
          and (storage.foldername(name))[1] = public.current_tenant_id()::text
          and public.has_admin_access()
        )
    $pol$;
  end if;
end $$;

comment on table public.tenant_domains is
  'Custom domains. verification_token is shown only to tenant admins. Anon uses get_site_by_host.';
comment on function public.get_site_by_host(text) is
  'Published public storefront for a host. Subdomain, localhost, or a verified custom domain. No drafts and no tokens.';
