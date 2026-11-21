-- Standalone fix for a hosted project that already has 2026-11-20_pgcrypto_schema.sql applied.
-- Safe to run more than once.

-- Supplier purchases and shop categories for the counter tiles.
-- Stock moves only when the tenant has stock_tracking.

create table if not exists public.product_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name),
  constraint product_categories_name_len check (char_length(btrim(name)) >= 1)
);

alter table public.products
  add column if not exists category_id uuid references public.product_categories (id) on delete set null;

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  supplier text,
  bill_date date,
  photo_ref text,
  notes text,
  taxable numeric(12, 2) not null default 0 check (taxable >= 0),
  tax numeric(12, 2) not null default 0 check (tax >= 0),
  total numeric(12, 2) not null default 0 check (total >= 0),
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists purchases_tenant_idx on public.purchases (tenant_id, bill_date desc);

create table if not exists public.purchase_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  purchase_id uuid not null references public.purchases (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  description text not null,
  quantity numeric(12, 3) not null check (quantity > 0),
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  gst_rate numeric(6, 3) not null default 0 check (gst_rate >= 0 and gst_rate <= 100),
  tax_amount numeric(12, 2) not null default 0 check (tax_amount >= 0),
  line_total numeric(12, 2) not null default 0 check (line_total >= 0),
  sort_order integer not null default 0,
  constraint purchase_lines_description_len check (char_length(btrim(description)) >= 1)
);

create index if not exists purchase_lines_purchase_idx on public.purchase_lines (purchase_id, sort_order);

create or replace function public.save_purchase(p_body jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tid uuid := public.current_tenant_id();
  purchase_id uuid;
  line jsonb;
  idx integer := 0;
  qty numeric;
  price numeric;
  rate numeric;
  taxable numeric;
  tax numeric;
  line_taxable numeric := 0;
  line_tax numeric := 0;
  track boolean;
begin
  if tid is null or not public.has_billing_access() then
    raise exception 'billing access is required' using errcode = '42501';
  end if;
  if p_body -> 'lines' is null or jsonb_typeof(p_body -> 'lines') <> 'array' or jsonb_array_length(p_body -> 'lines') = 0 then
    raise exception 'at least one line is required' using errcode = '22023';
  end if;

  insert into public.purchases (tenant_id, supplier, bill_date, photo_ref, notes, created_by)
  values (
    tid,
    nullif(btrim(coalesce(p_body ->> 'supplier', '')), ''),
    nullif(p_body ->> 'bill_date', '')::date,
    nullif(btrim(coalesce(p_body ->> 'photo_ref', '')), ''),
    nullif(btrim(coalesce(p_body ->> 'notes', '')), ''),
    auth.uid()
  )
  returning id into purchase_id;

  track := public.has_feature(tid, 'stock_tracking');

  for line in select value from jsonb_array_elements(p_body -> 'lines')
  loop
    idx := idx + 1;
    qty := coalesce((line ->> 'quantity')::numeric, 0);
    price := coalesce((line ->> 'unit_price')::numeric, 0);
    rate := coalesce((line ->> 'gst_rate')::numeric, nullif(p_body ->> 'gst_rate', '')::numeric, 0);
    taxable := round(qty * price, 2);
    tax := round(taxable * rate / 100.0, 2);
    line_taxable := line_taxable + taxable;
    line_tax := line_tax + tax;
    insert into public.purchase_lines (
      tenant_id, purchase_id, product_id, description, quantity, unit_price, gst_rate, tax_amount, line_total, sort_order
    ) values (
      tid,
      purchase_id,
      nullif(line ->> 'product_id', '')::uuid,
      coalesce(nullif(btrim(coalesce(line ->> 'description', '')), ''), 'Item'),
      qty,
      price,
      rate,
      tax,
      taxable + tax,
      idx
    );
    if track and nullif(line ->> 'product_id', '') is not null then
      update public.products
      set stock = stock + qty
      where id = (line ->> 'product_id')::uuid
        and tenant_id = tid
        and stock is not null;
    end if;
  end loop;

  update public.purchases
  set taxable = line_taxable,
      tax = line_tax,
      total = line_taxable + line_tax
  where id = purchase_id;

  return (
    select jsonb_build_object(
      'id', p.id,
      'supplier', p.supplier,
      'bill_date', p.bill_date,
      'photo_ref', p.photo_ref,
      'notes', p.notes,
      'taxable', p.taxable,
      'tax', p.tax,
      'total', p.total,
      'created_at', p.created_at,
      'lines', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', l.id,
          'product_id', l.product_id,
          'description', l.description,
          'quantity', l.quantity,
          'unit_price', l.unit_price,
          'gst_rate', l.gst_rate,
          'tax_amount', l.tax_amount,
          'line_total', l.line_total
        ) order by l.sort_order)
        from public.purchase_lines l
        where l.purchase_id = p.id
      ), '[]'::jsonb)
    )
    from public.purchases p
    where p.id = purchase_id
  );
end;
$$;

drop function if exists public.pos_tiles();

create or replace function public.pos_tiles(p_category uuid default null)
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
  categories jsonb;
  uncategorized jsonb;
begin
  if tid is null then
    raise exception 'no active tenant' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'name', p.name, 'unit', p.unit, 'price', p.price,
    'gst_rate', p.gst_rate, 'stock', p.stock, 'favourite', true, 'category_id', p.category_id
  ) order by p.name), '[]'::jsonb)
    into favourites
  from public.products p
  where p.tenant_id = tid and p.active and p.is_favourite
    and (p_category is null or p.category_id = p_category);

  select coalesce(jsonb_agg(jsonb_build_object(
    'name', s.name, 'sold_qty', s.sold_qty, 'product_id', s.product_id, 'category_id', s.category_id
  ) order by s.sold_qty desc), '[]'::jsonb)
    into top_sellers
  from (
    select
      it.description as name,
      sum(it.quantity) as sold_qty,
      (
        select pr.id from public.products pr
        where pr.tenant_id = tid
          and (pr.id = it.product_id or (it.product_id is null and lower(pr.name) = lower(it.description)))
        limit 1
      ) as product_id,
      (
        select pr.category_id from public.products pr
        where pr.tenant_id = tid
          and (pr.id = it.product_id or (it.product_id is null and lower(pr.name) = lower(it.description)))
        limit 1
      ) as category_id
    from public.invoice_items it
    join public.invoices i on i.id = it.invoice_id
    where i.tenant_id = tid
      and i.status <> 'void'
      and i.created_at > now() - interval '30 days'
    group by it.description, it.product_id
    order by sold_qty desc
    limit 12
  ) s
  where p_category is null or s.category_id = p_category;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'sort_order', c.sort_order,
    'tiles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'unit', p.unit, 'price', p.price,
        'gst_rate', p.gst_rate, 'stock', p.stock, 'favourite', p.is_favourite, 'category_id', p.category_id
      ) order by p.name)
      from public.products p
      where p.category_id = c.id and p.tenant_id = tid and p.active
    ), '[]'::jsonb)
  ) order by c.sort_order, c.name), '[]'::jsonb)
    into categories
  from public.product_categories c
  where c.tenant_id = tid
    and (p_category is null or c.id = p_category);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'name', p.name, 'unit', p.unit, 'price', p.price,
    'gst_rate', p.gst_rate, 'stock', p.stock, 'favourite', p.is_favourite, 'category_id', null
  ) order by p.name), '[]'::jsonb)
    into uncategorized
  from public.products p
  where p.tenant_id = tid and p.active and p.category_id is null
    and p_category is null;

  return jsonb_build_object(
    'favourites', favourites,
    'top_sellers', top_sellers,
    'categories', categories,
    'uncategorized', uncategorized
  );
end;
$$;

alter table public.product_categories enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_lines enable row level security;

drop policy if exists product_categories_select on public.product_categories;
create policy product_categories_select on public.product_categories
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists product_categories_write on public.product_categories;
create policy product_categories_write on public.product_categories
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_billing_access())
  with check (tenant_id = public.current_tenant_id() and public.has_billing_access());

drop policy if exists purchases_select on public.purchases;
create policy purchases_select on public.purchases
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists purchase_lines_select on public.purchase_lines;
create policy purchase_lines_select on public.purchase_lines
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

grant select, insert, update, delete on public.product_categories to authenticated;
grant select on public.purchases, public.purchase_lines to authenticated;
grant all privileges on public.product_categories, public.purchases, public.purchase_lines to service_role;

revoke all on function public.save_purchase(jsonb) from public, anon;
revoke all on function public.pos_tiles(uuid) from public, anon;
grant execute on function public.save_purchase(jsonb) to authenticated;
grant execute on function public.pos_tiles(uuid) to authenticated;
