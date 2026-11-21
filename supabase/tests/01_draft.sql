-- Minimal stand-in for the earlier draft that may already be on the project.
-- Migrations must drop these objects (IF EXISTS) and replace them.

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null
);

create table if not exists public.users (
  id uuid primary key,
  tenant_id uuid references public.tenants (id),
  email text,
  role text
);

create or replace function public.current_tenant_id()
returns uuid
language sql
stable
as $$
  select null::uuid;
$$;

create or replace function public.current_user_role()
returns text
language sql
stable
as $$
  select null::text;
$$;

alter table public.tenants enable row level security;
alter table public.users enable row level security;

drop policy if exists tenant_read on public.tenants;
create policy tenant_read on public.tenants for select using (true);

drop policy if exists user_read on public.users;
create policy user_read on public.users for select using (true);

insert into public.tenants (name) values ('draft leftover');
