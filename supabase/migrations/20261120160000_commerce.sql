-- WhatsApp sharing, GST document fields, reminders, and POS.
-- New tables are tenant-scoped. Anon cannot read them. Public invoice
-- views go through get_shared_invoice(token).

alter table public.customers
  add column if not exists billing_state_code text,
  add column if not exists reminder_opt_out boolean not null default false;

alter table public.invoice_items
  add column if not exists unit text not null default 'NOS',
  add column if not exists discount numeric(12, 2) not null default 0 check (discount >= 0);

alter table public.invoices
  add column if not exists document_type text not null default 'tax_invoice'
    check (document_type in ('tax_invoice', 'bill_of_supply', 'credit_note', 'debit_note')),
  add column if not exists financial_year text,
  add column if not exists amount_in_words text,
  add column if not exists cgst_total numeric(12, 2) not null default 0,
  add column if not exists sgst_total numeric(12, 2) not null default 0,
  add column if not exists igst_total numeric(12, 2) not null default 0,
  add column if not exists source text not null default 'billing' check (source in ('billing', 'pos')),
  add column if not exists reference_invoice_id uuid references public.invoices (id),
  add column if not exists irn text,
  add column if not exists ack_no text,
  add column if not exists ack_date timestamptz,
  add column if not exists signed_qr text,
  add column if not exists einvoice_status text not null default 'not_generated'
    check (einvoice_status in ('not_generated', 'pending', 'generated', 'cancelled', 'failed'));

alter table public.invoices drop constraint if exists invoices_number_max;
alter table public.invoices
  add constraint invoices_number_max check (char_length(number) <= 16);

alter table public.payments
  add column if not exists tendered numeric(12, 2),
  add column if not exists change_amount numeric(12, 2);

-- Line discount is part of the taxable value. Existing rows have discount 0.
create or replace function public.compute_item_amounts()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  tid uuid;
  supply public.supply_type;
  rate numeric(6, 3);
  taxable numeric(12, 2);
begin
  select i.tenant_id, i.supply_type into tid, supply
  from public.invoices i where i.id = new.invoice_id;
  if tid is null then
    raise exception 'invoice not found' using errcode = '23503';
  end if;
  new.tenant_id := tid;
  if new.tax_rate_id is not null then
    select tr.rate into rate from public.tax_rates tr
    where tr.id = new.tax_rate_id and tr.tenant_id = tid;
    if rate is null then
      raise exception 'tax rate not found for this tenant' using errcode = '23503';
    end if;
    new.tax_rate := rate;
  end if;
  taxable := round(new.quantity * new.unit_price - coalesce(new.discount, 0), 2);
  if taxable < 0 then
    raise exception 'line discount exceeds the line value' using errcode = '23514';
  end if;
  new.line_subtotal := taxable;
  new.tax_amount := round(taxable * coalesce(new.tax_rate, 0) / 100.0, 2);
  if supply = 'inter' then
    new.igst_amount := new.tax_amount;
    new.cgst_amount := 0;
    new.sgst_amount := 0;
  else
    new.cgst_amount := round(new.tax_amount / 2, 2);
    new.sgst_amount := new.tax_amount - new.cgst_amount;
    new.igst_amount := 0;
  end if;
  new.line_total := new.line_subtotal + new.tax_amount;
  return new;
end;
$$;

-- Recompute invoice tax split alongside the existing total trigger.
create or replace function public.stamp_invoice_gst()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  cgst numeric(12, 2);
  sgst numeric(12, 2);
  igst numeric(12, 2);
begin
  select coalesce(sum(cgst_amount), 0), coalesce(sum(sgst_amount), 0), coalesce(sum(igst_amount), 0)
    into cgst, sgst, igst
  from public.invoice_items where invoice_id = new.id;
  new.cgst_total := cgst;
  new.sgst_total := sgst;
  new.igst_total := igst;
  if new.financial_year is null then
    if extract(month from coalesce(new.issued_at, new.created_at, now())) >= 4 then
      new.financial_year := to_char(coalesce(new.issued_at, now()), 'YY') || to_char(coalesce(new.issued_at, now()) + interval '1 year', 'YY');
    else
      new.financial_year := to_char(coalesce(new.issued_at, now()) - interval '1 year', 'YY') || to_char(coalesce(new.issued_at, now()), 'YY');
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists invoices_stamp_gst on public.invoices;
create trigger invoices_stamp_gst
  before insert or update on public.invoices
  for each row execute function public.stamp_invoice_gst();

-- Financial-year gapless numbers, max 16 characters.
create table if not exists public.invoice_fy_counters (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  financial_year text not null,
  next_number integer not null default 1 check (next_number > 0),
  primary key (tenant_id, financial_year)
);

create or replace function public.next_invoice_number(p_tenant uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  prefix text;
  fy text;
  n integer;
  width integer;
  number text;
  now_ist timestamp := (now() at time zone 'Asia/Kolkata');
begin
  if extract(month from now_ist) >= 4 then
    fy := to_char(now_ist, 'YY') || to_char(now_ist + interval '1 year', 'YY');
  else
    fy := to_char(now_ist - interval '1 year', 'YY') || to_char(now_ist, 'YY');
  end if;

  select left(regexp_replace(coalesce(t.invoice_prefix, 'INV'), '[^A-Za-z0-9]', '', 'g'), 6)
    into prefix
  from public.tenants t where t.id = p_tenant;
  prefix := coalesce(nullif(prefix, ''), 'INV');

  insert into public.invoice_fy_counters (tenant_id, financial_year)
  values (p_tenant, fy)
  on conflict (tenant_id, financial_year) do nothing;

  update public.invoice_fy_counters
     set next_number = next_number + 1
   where tenant_id = p_tenant and financial_year = fy
  returning next_number - 1 into n;

  width := greatest(3, 16 - char_length(prefix) - char_length(fy));
  number := prefix || fy || lpad(n::text, width, '0');
  if char_length(number) > 16 then
    raise exception 'invoice number exceeds 16 characters' using errcode = '23514';
  end if;
  return number;
end;
$$;

-- ---------------------------------------------------------------------------
-- Sharing, messaging, reminders, catalog
-- ---------------------------------------------------------------------------

create table if not exists public.invoice_shares (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  token text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint invoice_shares_token_len check (char_length(token) >= 24)
);

create index if not exists invoice_shares_invoice_idx on public.invoice_shares (invoice_id);

create table if not exists public.whatsapp_settings (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  phone_number_id text,
  waba_id text,
  enabled boolean not null default false,
  access_token text,
  updated_at timestamptz not null default now()
);

create table if not exists public.messaging_settings (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  sms_provider text not null default 'none' check (sms_provider in ('none', 'msg91', 'twilio')),
  email_provider text not null default 'none' check (email_provider in ('none', 'smtp', 'resend')),
  msg91_sender_id text,
  msg91_dlt_template_id text,
  twilio_from text,
  smtp_host text,
  smtp_port integer,
  smtp_user text,
  resend_from text,
  secrets jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.message_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  invoice_id uuid references public.invoices (id) on delete set null,
  customer_id uuid references public.customers (id) on delete set null,
  channel text not null check (channel in ('whatsapp', 'sms', 'email')),
  status text not null check (status in ('queued', 'sent', 'delivered', 'read', 'failed', 'skipped')),
  provider text,
  provider_id text,
  error text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists message_logs_tenant_idx on public.message_logs (tenant_id, created_at desc);
create index if not exists message_logs_provider_idx on public.message_logs (provider_id) where provider_id is not null;

create table if not exists public.reminder_schedules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  offset_days integer not null,
  channel text not null check (channel in ('email', 'sms', 'whatsapp')),
  template text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, offset_days, channel)
);

create table if not exists public.reminder_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  schedule_id uuid references public.reminder_schedules (id) on delete set null,
  channel text not null,
  idempotency_key text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  provider_id text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, idempotency_key)
);

create index if not exists reminder_jobs_due_idx
  on public.reminder_jobs (status, next_attempt_at)
  where status = 'pending';

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  sku text,
  barcode text,
  hsn_sac text,
  unit text not null default 'NOS',
  price numeric(12, 2) not null check (price >= 0),
  gst_rate numeric(6, 3) not null default 0 check (gst_rate >= 0 and gst_rate <= 100),
  stock numeric(12, 3),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists products_tenant_idx on public.products (tenant_id, name);
create index if not exists products_barcode_idx on public.products (tenant_id, barcode);

create table if not exists public.pos_settings (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  default_tax_rate numeric(6, 3) not null default 18,
  receipt_footer text not null default 'Thank you.',
  paper_width integer not null default 80 check (paper_width in (58, 80)),
  updated_at timestamptz not null default now()
);

-- Public invoice view. Token is unguessable. Expired or revoked links return null.
create or replace function public.get_shared_invoice(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  share public.invoice_shares;
  inv public.invoices;
  seller public.tenants;
  buyer public.customers;
  lines jsonb;
begin
  select * into share from public.invoice_shares s
  where s.token = p_token and s.revoked_at is null and s.expires_at > now();
  if not found then
    return null;
  end if;
  select * into inv from public.invoices where id = share.invoice_id;
  select * into seller from public.tenants where id = inv.tenant_id;
  select * into buyer from public.customers where id = inv.customer_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'description', it.description,
    'hsn_sac', it.hsn_sac,
    'quantity', it.quantity,
    'unit', it.unit,
    'unit_price', it.unit_price,
    'discount', it.discount,
    'tax_rate', it.tax_rate,
    'cgst_amount', it.cgst_amount,
    'sgst_amount', it.sgst_amount,
    'igst_amount', it.igst_amount,
    'line_total', it.line_total
  ) order by it.sort_order), '[]'::jsonb)
    into lines
  from public.invoice_items it where it.invoice_id = inv.id;

  return jsonb_build_object(
    'number', inv.number,
    'document_type', inv.document_type,
    'status', inv.status,
    'supply_type', inv.supply_type,
    'place_of_supply', inv.place_of_supply,
    'currency', inv.currency,
    'issued_at', inv.issued_at,
    'due_at', inv.due_at,
    'amount', inv.amount,
    'tax', inv.tax,
    'discount', inv.discount,
    'cgst_total', inv.cgst_total,
    'sgst_total', inv.sgst_total,
    'igst_total', inv.igst_total,
    'total', inv.total,
    'amount_in_words', inv.amount_in_words,
    'irn', inv.irn,
    'ack_no', inv.ack_no,
    'seller', jsonb_build_object(
      'name', coalesce(seller.legal_name, seller.name),
      'gstin', seller.gstin,
      'state_code', seller.state_code,
      'address', seller.address_line1,
      'upi_vpa', seller.upi_vpa
    ),
    'buyer', jsonb_build_object(
      'name', buyer.name,
      'gstin', buyer.gstin,
      'state_code', buyer.billing_state_code
    ),
    'items', lines
  );
end;
$$;

create or replace function public.enqueue_due_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  insert into public.reminder_jobs (
    tenant_id, invoice_id, schedule_id, channel, idempotency_key, status, next_attempt_at
  )
  select
    i.tenant_id,
    i.id,
    s.id,
    s.channel,
    i.id::text || ':' || s.id::text || ':' || ((i.due_at at time zone 'Asia/Kolkata')::date + s.offset_days)::text,
    'pending',
    now()
  from public.invoices i
  join public.reminder_schedules s on s.tenant_id = i.tenant_id and s.enabled
  join public.customers c on c.id = i.customer_id
  where i.status in ('sent', 'overdue')
    and i.due_at is not null
    and coalesce(c.reminder_opt_out, false) = false
    and ((i.due_at at time zone 'Asia/Kolkata')::date + s.offset_days) <= (now() at time zone 'Asia/Kolkata')::date
    and ((i.due_at at time zone 'Asia/Kolkata')::date + s.offset_days) >= (now() at time zone 'Asia/Kolkata')::date - 3
  on conflict (tenant_id, idempotency_key) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.gstr1_summary(p_from date, p_to date)
returns table (
  hsn_sac text,
  tax_rate numeric,
  taxable_value numeric,
  cgst numeric,
  sgst numeric,
  igst numeric,
  total_tax numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    coalesce(it.hsn_sac, ''),
    it.tax_rate,
    sum(it.line_subtotal),
    sum(it.cgst_amount),
    sum(it.sgst_amount),
    sum(it.igst_amount),
    sum(it.tax_amount)
  from public.invoice_items it
  join public.invoices i on i.id = it.invoice_id
  where i.status <> 'void'
    and coalesce(i.issued_at, i.created_at)::date between p_from and p_to
  group by 1, 2
  order by 1, 2;
$$;

create or replace function public.pos_checkout(
  p_customer_id uuid,
  p_lines jsonb,
  p_method public.payment_method,
  p_supply public.supply_type,
  p_place text,
  p_tendered numeric
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  tid uuid := public.current_tenant_id();
  inv public.invoices;
  line jsonb;
  idx integer := 0;
begin
  if uid is null or tid is null or not public.has_billing_access() then
    raise exception 'billing access required' using errcode = '42501';
  end if;
  if p_customer_id is null or jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) < 1 then
    raise exception 'customer and at least one line are required' using errcode = '22023';
  end if;

  insert into public.invoices (
    tenant_id, customer_id, supply_type, place_of_supply, source, document_type, status
  ) values (
    tid, p_customer_id, p_supply, p_place, 'pos',
    case when exists (
      select 1 from jsonb_array_elements(p_lines) e where coalesce((e ->> 'gst_rate')::numeric, 0) > 0
    ) then 'tax_invoice' else 'bill_of_supply' end,
    'draft'
  ) returning * into inv;

  for line in select * from jsonb_array_elements(p_lines)
  loop
    idx := idx + 1;
    insert into public.invoice_items (
      tenant_id, invoice_id, description, quantity, unit_price, discount, tax_rate, hsn_sac, unit, sort_order
    ) values (
      tid,
      inv.id,
      line ->> 'description',
      (line ->> 'quantity')::numeric,
      (line ->> 'unit_price')::numeric,
      coalesce((line ->> 'discount')::numeric, 0),
      coalesce((line ->> 'gst_rate')::numeric, 0),
      line ->> 'hsn_sac',
      coalesce(line ->> 'unit', 'NOS'),
      idx
    );
    if (line ->> 'product_id') is not null and (line ->> 'quantity') is not null then
      update public.products
         set stock = stock - (line ->> 'quantity')::numeric
       where id = (line ->> 'product_id')::uuid
         and tenant_id = tid
         and stock is not null;
    end if;
  end loop;

  select * into inv from public.invoices where id = inv.id;

  insert into public.payments (
    tenant_id, invoice_id, amount, method, status, tendered, change_amount, paid_at
  ) values (
    tid,
    inv.id,
    inv.total,
    p_method,
    'succeeded',
    p_tendered,
    case when p_method = 'cash' and p_tendered is not null then greatest(p_tendered - inv.total, 0) else null end,
    now()
  );

  select * into inv from public.invoices where id = inv.id;
  return jsonb_build_object('invoice_id', inv.id, 'number', inv.number, 'total', inv.total, 'status', inv.status);
end;
$$;

-- RLS
do $$
declare t text;
begin
  foreach t in array array[
    'invoice_shares', 'whatsapp_settings', 'messaging_settings', 'message_logs',
    'reminder_schedules', 'reminder_jobs', 'products', 'pos_settings', 'invoice_fy_counters'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

create policy invoice_shares_select on public.invoice_shares for select to authenticated
  using (tenant_id = public.current_tenant_id());
create policy invoice_shares_write on public.invoice_shares for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_billing_access())
  with check (tenant_id = public.current_tenant_id() and public.has_billing_access());

create policy whatsapp_settings_all on public.whatsapp_settings for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_admin_access())
  with check (tenant_id = public.current_tenant_id() and public.has_admin_access());

create policy messaging_settings_all on public.messaging_settings for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_admin_access())
  with check (tenant_id = public.current_tenant_id() and public.has_admin_access());

create policy message_logs_select on public.message_logs for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_billing_access());
create policy message_logs_insert on public.message_logs for insert to authenticated
  with check (tenant_id = public.current_tenant_id() and public.has_billing_access());

create policy reminder_schedules_all on public.reminder_schedules for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_admin_access())
  with check (tenant_id = public.current_tenant_id() and public.has_admin_access());
create policy reminder_schedules_read on public.reminder_schedules for select to authenticated
  using (tenant_id = public.current_tenant_id());

create policy reminder_jobs_select on public.reminder_jobs for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_billing_access());

create policy products_select on public.products for select to authenticated
  using (tenant_id = public.current_tenant_id());
create policy products_write on public.products for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_billing_access())
  with check (tenant_id = public.current_tenant_id() and public.has_billing_access());

create policy pos_settings_all on public.pos_settings for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_admin_access())
  with check (tenant_id = public.current_tenant_id() and public.has_admin_access());
create policy pos_settings_read on public.pos_settings for select to authenticated
  using (tenant_id = public.current_tenant_id());

create policy fy_counters_select on public.invoice_fy_counters for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_billing_access());

grant select, insert, update, delete on public.invoice_shares to authenticated;
grant select, insert, update, delete on public.whatsapp_settings to authenticated;
grant select, insert, update, delete on public.messaging_settings to authenticated;
grant select, insert on public.message_logs to authenticated;
grant select, insert, update, delete on public.reminder_schedules to authenticated;
grant select on public.reminder_jobs to authenticated;
grant select, insert, update, delete on public.products to authenticated;
grant select, insert, update, delete on public.pos_settings to authenticated;
grant select on public.invoice_fy_counters to authenticated;
grant all privileges on public.invoice_shares, public.whatsapp_settings, public.messaging_settings,
  public.message_logs, public.reminder_schedules, public.reminder_jobs, public.products,
  public.pos_settings, public.invoice_fy_counters to service_role;

revoke select (access_token) on public.whatsapp_settings from authenticated, anon;
revoke select (secrets) on public.messaging_settings from authenticated, anon;

revoke all on function public.get_shared_invoice(text) from public;
grant execute on function public.get_shared_invoice(text) to anon, authenticated, service_role;
revoke all on function public.enqueue_due_reminders() from public, anon, authenticated;
grant execute on function public.enqueue_due_reminders() to service_role;
grant execute on function public.gstr1_summary(date, date) to authenticated, service_role;
grant execute on function public.pos_checkout(uuid, jsonb, public.payment_method, public.supply_type, text, numeric)
  to authenticated, service_role;
revoke all on function public.next_invoice_number(uuid) from public, anon;
grant execute on function public.next_invoice_number(uuid) to authenticated, service_role;

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
    values ('invoice-pdfs', 'invoice-pdfs', false)
    on conflict (id) do nothing;
    execute 'drop policy if exists invoice_pdfs_read on storage.objects';
    execute $p$
      create policy invoice_pdfs_read on storage.objects
        for select to authenticated
        using (
          bucket_id = 'invoice-pdfs'
          and (storage.foldername(name))[1] = public.current_tenant_id()::text
        )
    $p$;
  end if;
end $$;
