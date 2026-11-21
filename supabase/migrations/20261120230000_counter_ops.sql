-- Counter sync, morning summary, invoice timeline, ledger links.
-- User-facing RPCs run as the caller (security definer + membership checks).
-- Invoice numbers are assigned by next_invoice_number inside the sync transaction.

alter table public.invoices
  add column if not exists client_id uuid,
  add column if not exists device_id text;

alter table public.payments
  add column if not exists client_id uuid;

alter table public.invoice_items
  add column if not exists product_id uuid references public.products (id) on delete set null;

alter table public.products
  add column if not exists is_favourite boolean not null default false,
  add column if not exists reorder_level numeric(12, 3) not null default 5;

alter table public.tenants
  add column if not exists locale text not null default 'en';

alter table public.tenants drop constraint if exists tenants_locale_known;
alter table public.tenants
  add constraint tenants_locale_known check (locale in ('en', 'bn'));

create unique index if not exists invoices_client_id_idx
  on public.invoices (tenant_id, client_id) where client_id is not null;

create unique index if not exists payments_client_id_idx
  on public.payments (tenant_id, client_id) where client_id is not null;

create table if not exists public.invoice_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  kind text not null check (kind in (
    'created', 'sent', 'viewed', 'reminder_sent', 'payment_received', 'voided', 'synced'
  )),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists invoice_events_invoice_idx
  on public.invoice_events (invoice_id, created_at);

create unique index if not exists invoice_events_viewed_day
  on public.invoice_events (invoice_id, ((created_at at time zone 'Asia/Kolkata')::date))
  where kind = 'viewed';

create table if not exists public.customer_ledger_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  token text not null unique,
  revoked_at timestamptz,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint customer_ledger_token_len check (char_length(token) >= 24)
);

create index if not exists customer_ledger_customer_idx
  on public.customer_ledger_links (customer_id, created_at desc);

create or replace function public.record_invoice_event(
  p_invoice uuid,
  p_kind text,
  p_metadata jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  tid uuid;
begin
  select tenant_id into tid from public.invoices where id = p_invoice;
  if tid is null then
    return;
  end if;
  insert into public.invoice_events (tenant_id, invoice_id, kind, metadata)
  values (tid, p_invoice, p_kind, coalesce(p_metadata, '{}'::jsonb));
exception
  when unique_violation then
    null;
end;
$$;

create or replace function public.log_invoice_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.record_invoice_event(new.id, 'created', '{}'::jsonb);
  return new;
end;
$$;

drop trigger if exists invoices_log_created on public.invoices;
create trigger invoices_log_created
  after insert on public.invoices
  for each row execute function public.log_invoice_created();

create or replace function public.log_invoice_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status and new.status = 'sent' then
    perform public.record_invoice_event(new.id, 'sent', '{}'::jsonb);
  elsif new.status is distinct from old.status and new.status = 'void' then
    perform public.record_invoice_event(new.id, 'voided', '{}'::jsonb);
  end if;
  return new;
end;
$$;

drop trigger if exists invoices_log_status on public.invoices;
create trigger invoices_log_status
  after update of status on public.invoices
  for each row execute function public.log_invoice_status();

create or replace function public.log_payment_received()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'succeeded' and (tg_op = 'INSERT' or old.status is distinct from 'succeeded') then
    perform public.record_invoice_event(new.invoice_id, 'payment_received', jsonb_build_object(
      'payment_id', new.id, 'amount', new.amount, 'method', new.method
    ));
  end if;
  return new;
end;
$$;

drop trigger if exists payments_log_received on public.payments;
create trigger payments_log_received
  after insert or update of status on public.payments
  for each row execute function public.log_payment_received();

create or replace function public.log_reminder_sent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'sent' and (tg_op = 'INSERT' or old.status is distinct from 'sent') then
    perform public.record_invoice_event(new.invoice_id, 'reminder_sent', jsonb_build_object(
      'channel', new.channel, 'job_id', new.id
    ));
  end if;
  return new;
end;
$$;

drop trigger if exists reminder_jobs_log_sent on public.reminder_jobs;
create trigger reminder_jobs_log_sent
  after insert or update of status on public.reminder_jobs
  for each row execute function public.log_reminder_sent();

create or replace function public.record_share_view(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  share public.invoice_shares;
begin
  select * into share from public.invoice_shares s
  where s.token = p_token and s.revoked_at is null and s.expires_at > now();
  if not found then
    return;
  end if;
  perform public.record_invoice_event(share.invoice_id, 'viewed', jsonb_build_object('token_id', share.id));
end;
$$;

create or replace function public.sync_offline_sales(p_sales jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tid uuid := public.current_tenant_id();
  sale jsonb;
  line jsonb;
  pay jsonb;
  results jsonb := '[]'::jsonb;
  existing public.invoices;
  inv_id uuid;
  customer uuid;
  walk_in uuid;
  pay_id uuid;
  method public.payment_method;
  created_new boolean;
  assigned_number text;
begin
  if tid is null or not public.has_billing_access() then
    raise exception 'billing access is required' using errcode = '42501';
  end if;
  if p_sales is null or jsonb_typeof(p_sales) <> 'array' then
    raise exception 'sales must be an array' using errcode = '22023';
  end if;

  for sale in select value from jsonb_array_elements(p_sales)
  loop
    begin
      if (sale ->> 'client_id') is null then
        raise exception 'client_id is required' using errcode = '22023';
      end if;

      select * into existing
      from public.invoices
      where tenant_id = tid and client_id = (sale ->> 'client_id')::uuid;

      if existing.id is not null and existing.status = 'void' then
        results := results || jsonb_build_array(jsonb_build_object(
          'client_id', sale ->> 'client_id',
          'status', 'conflict',
          'reason', 'voided',
          'invoice_id', existing.id,
          'number', existing.number
        ));
        continue;
      end if;

      created_new := existing.id is null;
      if created_new then
        customer := nullif(sale ->> 'customer_id', '')::uuid;
        if customer is null then
          select c.id into walk_in from public.customers c
          where c.tenant_id = tid and c.name = 'Walk-in'
          limit 1;
          if walk_in is null then
            insert into public.customers (tenant_id, name)
            values (tid, 'Walk-in')
            returning id into walk_in;
          end if;
          customer := walk_in;
        end if;

        insert into public.invoices (
          tenant_id, customer_id, number, status, source, client_id, device_id, notes, currency
        ) values (
          tid, customer, '', 'draft', 'billing',
          (sale ->> 'client_id')::uuid,
          nullif(sale ->> 'device_id', ''),
          nullif(sale ->> 'notes', ''),
          'INR'
        )
        returning id into inv_id;

        for line in select value from jsonb_array_elements(coalesce(sale -> 'lines', '[]'::jsonb))
        loop
          insert into public.invoice_items (
            tenant_id, invoice_id, product_id, description, quantity, unit_price, tax_rate, unit, discount
          ) values (
            tid,
            inv_id,
            nullif(line ->> 'product_id', '')::uuid,
            coalesce(nullif(line ->> 'description', ''), 'Item'),
            coalesce((line ->> 'quantity')::numeric, 1),
            coalesce((line ->> 'unit_price')::numeric, 0),
            coalesce((line ->> 'gst_rate')::numeric, 0),
            coalesce(nullif(line ->> 'unit', ''), 'NOS'),
            coalesce((line ->> 'discount')::numeric, 0)
          );
        end loop;

        update public.invoices set status = 'sent' where id = inv_id and status = 'draft';
        perform public.record_invoice_event(inv_id, 'synced', jsonb_build_object('device_id', sale ->> 'device_id'));
      else
        inv_id := existing.id;
      end if;

      for pay in select value from jsonb_array_elements(coalesce(sale -> 'payments', '[]'::jsonb))
      loop
        if (pay ->> 'client_id') is not null and exists (
          select 1 from public.payments p
          where p.tenant_id = tid and p.client_id = (pay ->> 'client_id')::uuid
        ) then
          continue;
        end if;
        method := coalesce(nullif(pay ->> 'method', ''), 'cash')::public.payment_method;
        insert into public.payments (
          tenant_id, invoice_id, client_id, amount, method, status,
          amount_tendered, change_given, paid_at, transaction_ref, recorded_by
        ) values (
          tid,
          inv_id,
          nullif(pay ->> 'client_id', '')::uuid,
          (pay ->> 'amount')::numeric,
          method,
          'succeeded',
          nullif(pay ->> 'amount_tendered', '')::numeric,
          nullif(pay ->> 'change_given', '')::numeric,
          coalesce(nullif(pay ->> 'paid_at', '')::timestamptz, now()),
          nullif(pay ->> 'transaction_ref', ''),
          auth.uid()
        )
        returning id into pay_id;
      end loop;

      select i.number into assigned_number from public.invoices i where i.id = inv_id;
      results := results || jsonb_build_array(jsonb_build_object(
        'client_id', sale ->> 'client_id',
        'status', case when created_new then 'created' else 'exists' end,
        'invoice_id', inv_id,
        'number', assigned_number
      ));
    exception
      when others then
        results := results || jsonb_build_array(jsonb_build_object(
          'client_id', sale ->> 'client_id',
          'status', 'conflict',
          'reason', sqlerrm
        ));
    end;
  end loop;

  return results;
end;
$$;

create or replace function public.pos_tiles()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  tid uuid := public.current_tenant_id();
  favourites jsonb;
  top_sellers jsonb;
begin
  if tid is null then
    raise exception 'no active tenant' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row_to_json(f) order by f.name), '[]'::jsonb)
    into favourites
  from (
    select p.id, p.name, p.unit, p.price, p.gst_rate, p.stock, true as favourite
    from public.products p
    where p.tenant_id = tid and p.active and p.is_favourite
    order by p.name
    limit 24
  ) f;

  select coalesce(jsonb_agg(row_to_json(s) order by s.sold_qty desc), '[]'::jsonb)
    into top_sellers
  from (
    select
      it.description as name,
      sum(it.quantity) as sold_qty,
      (
        select pr.id from public.products pr
        where pr.tenant_id = tid and lower(pr.name) = lower(it.description)
        limit 1
      ) as product_id
    from public.invoice_items it
    join public.invoices i on i.id = it.invoice_id
    where i.tenant_id = tid
      and i.status <> 'void'
      and i.created_at > now() - interval '30 days'
    group by it.description
    order by sold_qty desc
    limit 12
  ) s;

  return jsonb_build_object('favourites', favourites, 'top_sellers', top_sellers);
end;
$$;

create or replace function public.morning_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  tid uuid := public.current_tenant_id();
  today date := (now() at time zone 'Asia/Kolkata')::date;
  yesterday date := today - 1;
  sales numeric;
  invoice_count integer;
  dues jsonb;
  low_stock jsonb;
  series7 jsonb;
  series30 jsonb;
begin
  if tid is null then
    raise exception 'no active tenant' using errcode = '42501';
  end if;

  select coalesce(sum(i.total), 0), count(*)
    into sales, invoice_count
  from public.invoices i
  where i.tenant_id = tid
    and i.status <> 'void'
    and (i.created_at at time zone 'Asia/Kolkata')::date = yesterday;

  select coalesce(jsonb_agg(row_to_json(d) order by d.balance desc), '[]'::jsonb)
    into dues
  from (
    select c.id as customer_id, c.name, b.balance
    from public.customers c
    join lateral (
      select greatest(0,
        coalesce((select sum(i.total) from public.invoices i where i.customer_id = c.id and i.tenant_id = tid and i.status <> 'void'), 0)
        - coalesce((
          select sum(p.amount) from public.payments p
          join public.invoices i on i.id = p.invoice_id
          where i.customer_id = c.id and i.tenant_id = tid and i.status <> 'void' and p.status = 'succeeded'
        ), 0)
      ) as balance
    ) b on true
    where c.tenant_id = tid and b.balance > 0
    order by b.balance desc
    limit 5
  ) d;

  select coalesce(jsonb_agg(row_to_json(s) order by s.stock), '[]'::jsonb)
    into low_stock
  from (
    select p.id as product_id, p.name, p.stock
    from public.products p
    where p.tenant_id = tid and p.active and p.stock is not null and p.stock <= p.reorder_level
    order by p.stock
    limit 8
  ) s;

  select coalesce(jsonb_agg(jsonb_build_object('date', day::text, 'sales', coalesce(v.sales, 0)) order by day), '[]'::jsonb)
    into series7
  from generate_series(today - 6, today, interval '1 day') as day
  left join (
    select (i.created_at at time zone 'Asia/Kolkata')::date as sold_on, sum(i.total) as sales
    from public.invoices i
    where i.tenant_id = tid and i.status <> 'void'
      and (i.created_at at time zone 'Asia/Kolkata')::date >= today - 6
    group by 1
  ) v on v.sold_on = day::date;

  select coalesce(jsonb_agg(jsonb_build_object('date', day::text, 'sales', coalesce(v.sales, 0)) order by day), '[]'::jsonb)
    into series30
  from generate_series(today - 29, today, interval '1 day') as day
  left join (
    select (i.created_at at time zone 'Asia/Kolkata')::date as sold_on, sum(i.total) as sales
    from public.invoices i
    where i.tenant_id = tid and i.status <> 'void'
      and (i.created_at at time zone 'Asia/Kolkata')::date >= today - 29
    group by 1
  ) v on v.sold_on = day::date;

  return jsonb_build_object(
    'yesterday', jsonb_build_object('sales', sales, 'invoice_count', invoice_count),
    'top_dues', dues,
    'low_stock', low_stock,
    'series_7d', series7,
    'series_30d', series30
  );
end;
$$;

create or replace function public.create_customer_ledger_link(p_customer uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tid uuid := public.current_tenant_id();
  token text := encode(gen_random_bytes(24), 'hex');
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

create or replace function public.revoke_customer_ledger_link(p_customer uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tid uuid := public.current_tenant_id();
  n integer;
begin
  if tid is null or not public.has_billing_access() then
    raise exception 'billing access is required' using errcode = '42501';
  end if;
  update public.customer_ledger_links
  set revoked_at = now()
  where customer_id = p_customer and tenant_id = tid and revoked_at is null;
  get diagnostics n = row_count;
  return jsonb_build_object('revoked', n);
end;
$$;

create or replace function public.get_customer_ledger(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  link public.customer_ledger_links;
  shop public.tenants;
  buyer public.customers;
  invoices jsonb;
  payments jsonb;
  balance numeric;
  razorpay_on boolean;
begin
  select * into link from public.customer_ledger_links
  where token = p_token and revoked_at is null;
  if not found then
    return null;
  end if;
  select * into shop from public.tenants where id = link.tenant_id;
  select * into buyer from public.customers where id = link.customer_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id, 'number', i.number, 'status', i.status, 'total', i.total,
    'issued_at', i.issued_at, 'due_at', i.due_at, 'created_at', i.created_at
  ) order by i.created_at), '[]'::jsonb)
    into invoices
  from public.invoices i
  where i.customer_id = buyer.id and i.tenant_id = shop.id and i.status <> 'void';

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'invoice_id', p.invoice_id, 'amount', p.amount, 'method', p.method,
    'status', p.status, 'paid_at', p.paid_at
  ) order by p.paid_at), '[]'::jsonb)
    into payments
  from public.payments p
  join public.invoices i on i.id = p.invoice_id
  where i.customer_id = buyer.id and i.tenant_id = shop.id and p.status = 'succeeded';

  select greatest(0,
    coalesce((select sum(i.total) from public.invoices i where i.customer_id = buyer.id and i.status <> 'void'), 0)
    - coalesce((
      select sum(p.amount) from public.payments p
      join public.invoices i on i.id = p.invoice_id
      where i.customer_id = buyer.id and p.status = 'succeeded' and i.status <> 'void'
    ), 0)
  ) into balance;

  select exists (
    select 1 from public.tenant_razorpay r
    where r.tenant_id = shop.id and r.enabled and r.key_id is not null
  ) into razorpay_on;

  return jsonb_build_object(
    'shop', jsonb_build_object(
      'name', coalesce(shop.legal_name, shop.name),
      'locale', shop.locale,
      'upi_vpa', shop.upi_vpa,
      'upi_payee_name', coalesce(shop.upi_payee_name, shop.legal_name, shop.name)
    ),
    'customer', jsonb_build_object('id', buyer.id, 'name', buyer.name),
    'invoices', invoices,
    'payments', payments,
    'balance', balance,
    'razorpay_available', razorpay_on
  );
end;
$$;

alter table public.invoice_events enable row level security;
alter table public.customer_ledger_links enable row level security;

drop policy if exists invoice_events_select on public.invoice_events;
create policy invoice_events_select on public.invoice_events
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists customer_ledger_select on public.customer_ledger_links;
create policy customer_ledger_select on public.customer_ledger_links
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

grant select on public.invoice_events to authenticated;
grant select on public.customer_ledger_links to authenticated;
grant all privileges on public.invoice_events, public.customer_ledger_links to service_role;

revoke all on function public.record_invoice_event(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.sync_offline_sales(jsonb) from public, anon;
revoke all on function public.pos_tiles() from public, anon;
revoke all on function public.morning_summary() from public, anon;
revoke all on function public.create_customer_ledger_link(uuid) from public, anon;
revoke all on function public.revoke_customer_ledger_link(uuid) from public, anon;
revoke all on function public.get_customer_ledger(text) from public;
revoke all on function public.record_share_view(text) from public;

grant execute on function public.sync_offline_sales(jsonb) to authenticated;
grant execute on function public.pos_tiles() to authenticated;
grant execute on function public.morning_summary() to authenticated;
grant execute on function public.create_customer_ledger_link(uuid) to authenticated;
grant execute on function public.revoke_customer_ledger_link(uuid) to authenticated;
grant execute on function public.get_customer_ledger(text) to anon, authenticated;
grant execute on function public.record_share_view(text) to anon, authenticated;
grant execute on function public.record_invoice_event(uuid, text, jsonb) to service_role;
