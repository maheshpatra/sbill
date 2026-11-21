-- Billflow migration 5 of 4 (applied after RLS grants).
-- invite_member looks up users by email as security definer, so an admin
-- does not gain a way to list every profile through RLS.
-- Pending invitations are accepted when auth.users inserts a matching email.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.invitations;
begin
  insert into public.users (id, email, name)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'name',
      new.raw_user_meta_data ->> 'full_name',
      split_part(coalesce(new.email, 'user'), '@', 1)
    )
  )
  on conflict (id) do update
    set email = excluded.email,
        name = coalesce(public.users.name, excluded.name);

  if new.email is not null then
    for inv in
      select *
      from public.invitations i
      where lower(i.email) = lower(new.email)
        and i.status = 'pending'
        and i.expires_at > now()
    loop
      insert into public.memberships (tenant_id, user_id, role, status)
      values (inv.tenant_id, new.id, inv.role, 'active')
      on conflict (tenant_id, user_id) do update
        set role = excluded.role,
            status = 'active';
      update public.invitations
         set status = 'accepted'
       where id = inv.id;
    end loop;
  end if;

  return new;
end;
$$;

create or replace function public.invite_member(p_email text, p_role public.member_role)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  tid uuid := public.current_tenant_id();
  existing uuid;
  member_limit integer;
  member_count integer;
  m public.memberships;
  inv public.invitations;
  features jsonb;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if tid is null or not public.has_admin_access() then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('admin', 'billing', 'member') then
    raise exception 'role must be admin, billing, or member' using errcode = '22023';
  end if;
  if p_email is null or btrim(p_email) !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'a valid email is required' using errcode = '22023';
  end if;

  select pl.features into features
  from public.tenants t
  join public.plans pl on pl.code = t.plan
  where t.id = tid;

  if features is not null and features ? 'members' and jsonb_typeof(features -> 'members') = 'number' then
    member_limit := (features ->> 'members')::integer;
    select count(*) into member_count
    from public.memberships ms
    where ms.tenant_id = tid
      and ms.status = 'active';
    if member_count >= member_limit then
      raise exception 'plan member limit reached' using errcode = '23514';
    end if;
  end if;

  select u.id into existing
  from public.users u
  where lower(u.email) = lower(btrim(p_email));

  if existing is not null then
    if existing = uid and p_role::text is distinct from public.current_user_role() then
      raise exception 'cannot change your own role with invite_member' using errcode = '23514';
    end if;
    insert into public.memberships (tenant_id, user_id, role, status)
    values (tid, existing, p_role, 'active')
    on conflict (tenant_id, user_id) do update
      set role = excluded.role,
          status = 'active'
    returning * into m;
    return jsonb_build_object(
      'kind', 'membership',
      'membership_id', m.id,
      'user_id', m.user_id,
      'role', m.role,
      'status', m.status,
      'email', lower(btrim(p_email))
    );
  end if;

  insert into public.invitations (tenant_id, email, role, status, invited_by)
  values (tid, lower(btrim(p_email)), p_role, 'pending', uid)
  on conflict (tenant_id, lower(email)) where status = 'pending'
  do update set role = excluded.role, invited_by = excluded.invited_by, expires_at = now() + interval '14 days'
  returning * into inv;

  return jsonb_build_object(
    'kind', 'invitation',
    'invitation_id', inv.id,
    'email', inv.email,
    'role', inv.role,
    'status', inv.status,
    'expires_at', inv.expires_at
  );
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.invite_member(text, public.member_role) from public, anon, authenticated;
grant execute on function public.invite_member(text, public.member_role) to authenticated, service_role;

comment on function public.invite_member(text, public.member_role) is
  'Admin of the active tenant adds an existing user or records a pending invitation. Returns {kind: membership|invitation, ...}.';
