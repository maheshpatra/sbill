-- UPI QR collect. Manual confirmation, not a payment gateway.
-- upi_qr on an invoice is available on every plan, including free.
-- A counter UPI sale still requires the pos feature.

alter table public.tenants
  add column if not exists upi_payee_name text;

alter table public.tenants drop constraint if exists tenants_upi_vpa_format;
alter table public.tenants
  add constraint tenants_upi_vpa_format check (
    upi_vpa is null or upi_vpa ~ '^[a-zA-Z0-9._-]{2,255}@[a-zA-Z]{2,64}$'
  );

alter table public.payments
  add column if not exists upi_utr text;

alter table public.payments drop constraint if exists payments_upi_utr_format;
alter table public.payments
  add constraint payments_upi_utr_format check (upi_utr is null or upi_utr ~ '^[0-9]{12}$');

alter type public.payment_method add value if not exists 'upi_qr';
alter type public.payment_status add value if not exists 'void';
alter type public.invoice_status add value if not exists 'partially_paid';

update public.plan_features pf
set enabled = true
from public.plans p
where pf.plan_id = p.id
  and pf.feature_key = 'upi_qr';

update public.plans
set features = jsonb_set(features, '{upi_qr}', 'true'::jsonb, true);

-- Invoice status machine now includes a partial payment.
create or replace function public.enforce_invoice_transition()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  subtotal numeric(12, 2);
  tax_sum numeric(12, 2);
  paid numeric(12, 2);
  allowed text[];
begin
  select coalesce(sum(line_subtotal), 0), coalesce(sum(tax_amount), 0)
    into subtotal, tax_sum
  from public.invoice_items
  where invoice_id = new.id;

  new.amount := subtotal;
  new.tax := tax_sum;
  new.total := round(new.amount + new.tax - coalesce(new.discount, 0), 2);

  if new.total < 0 then
    raise exception 'discount exceeds the invoice taxable value' using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' then
    if new.number is distinct from old.number then
      raise exception 'invoice number is immutable' using errcode = '23514';
    end if;
    if new.tenant_id is distinct from old.tenant_id then
      raise exception 'tenant_id is immutable' using errcode = '23514';
    end if;
    if old.status <> 'draft' and new.customer_id is distinct from old.customer_id then
      raise exception 'customer cannot change after the invoice leaves draft'
        using errcode = '23514';
    end if;

    if new.status is distinct from old.status then
      allowed := case old.status
        when 'draft' then array['draft', 'sent', 'void', 'paid', 'partially_paid']
        when 'sent' then array['sent', 'overdue', 'paid', 'partially_paid', 'void']
        when 'overdue' then array['overdue', 'sent', 'paid', 'partially_paid', 'void']
        when 'partially_paid' then array['partially_paid', 'paid', 'sent', 'overdue', 'void']
        when 'paid' then array['paid', 'void', 'sent', 'overdue', 'partially_paid']
        else array['void']
      end;
      if not (new.status::text = any (allowed)) then
        raise exception 'invalid invoice status transition from % to %', old.status, new.status
          using errcode = '23514';
      end if;
    end if;

    if new.status = 'sent' and old.status = 'draft' then
      new.issued_at := coalesce(new.issued_at, now());
      new.due_at := coalesce(new.due_at, now() + interval '15 days');
    end if;

    select coalesce(sum(amount), 0) into paid
    from public.payments
    where invoice_id = new.id
      and status = 'succeeded';

    if new.status = 'paid' and old.status is distinct from 'paid' then
      if paid < new.total then
        raise exception 'payments do not cover the invoice total' using errcode = '23514';
      end if;
      new.paid_at := coalesce(new.paid_at, now());
    end if;

    if old.status = 'paid' and new.status in ('sent', 'overdue', 'partially_paid') and paid >= new.total then
      raise exception 'invoice is fully paid' using errcode = '23514';
    end if;

    if new.status = 'void' and old.status is distinct from 'void' then
      if exists (
        select 1 from public.payments
        where invoice_id = new.id and status = 'succeeded'
      ) then
        raise exception 'refund payments before voiding an invoice' using errcode = '23514';
      end if;
    end if;

    if new.status is distinct from 'paid' then
      if old.status = 'paid' and new.status <> 'paid' then
        new.paid_at := null;
      end if;
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.sync_invoice_payment_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  inv uuid := coalesce(new.invoice_id, old.invoice_id);
  paid numeric(12, 2);
  tot numeric(12, 2);
  st public.invoice_status;
  stamp timestamptz := now();
begin
  if tg_op <> 'DELETE' and new.paid_at is not null then
    stamp := new.paid_at;
  end if;

  select coalesce(sum(amount), 0) into paid
  from public.payments
  where invoice_id = inv
    and status = 'succeeded';

  select total, status into tot, st
  from public.invoices
  where id = inv;

  if st = 'void' then
    return coalesce(new, old);
  end if;

  if tot is not null and paid >= tot then
    update public.invoices
       set status = 'paid',
           paid_at = coalesce(paid_at, stamp)
     where id = inv
       and status is distinct from 'paid';
  elsif paid > 0 then
    update public.invoices
       set status = 'partially_paid',
           paid_at = null
     where id = inv
       and status is distinct from 'partially_paid';
  elsif st in ('paid', 'partially_paid') then
    update public.invoices
       set status = case when due_at is not null and due_at < now() then 'overdue'::public.invoice_status else 'sent'::public.invoice_status end,
           paid_at = null
     where id = inv;
  end if;

  return coalesce(new, old);
end;
$$;

create or replace function public.confirm_upi_payment(p_payment uuid, p_utr text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pay public.payments;
  inv public.invoices;
begin
  if auth.uid() is null or not public.has_billing_access() then
    raise exception 'billing access required' using errcode = '42501';
  end if;
  if p_utr is not null and btrim(p_utr) <> '' and btrim(p_utr) !~ '^[0-9]{12}$' then
    raise exception 'UTR must be 12 digits' using errcode = '22023';
  end if;

  update public.payments
     set status = 'succeeded',
         upi_utr = nullif(btrim(coalesce(p_utr, '')), ''),
         paid_at = now()
   where id = p_payment
     and tenant_id = public.current_tenant_id()
     and method = 'upi_qr'
     and status = 'pending'
  returning * into pay;

  if pay.id is null then
    raise exception 'pending UPI payment not found' using errcode = 'P0002';
  end if;

  select * into inv from public.invoices where id = pay.invoice_id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    pay.tenant_id,
    auth.uid(),
    'upi.confirmed',
    'payments',
    pay.id,
    jsonb_build_object('invoice_id', pay.invoice_id, 'amount', pay.amount, 'tr', pay.transaction_ref, 'utr', pay.upi_utr)
  );

  return jsonb_build_object(
    'payment_id', pay.id,
    'invoice_id', inv.id,
    'invoice_status', inv.status,
    'amount', pay.amount,
    'utr', pay.upi_utr
  );
end;
$$;

create or replace function public.void_upi_payment(p_payment uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pay public.payments;
begin
  if auth.uid() is null or not public.has_billing_access() then
    raise exception 'billing access required' using errcode = '42501';
  end if;

  update public.payments
     set status = 'void'
   where id = p_payment
     and tenant_id = public.current_tenant_id()
     and method = 'upi_qr'
     and status = 'pending'
  returning * into pay;

  if pay.id is null then
    raise exception 'pending UPI payment not found' using errcode = 'P0002';
  end if;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    pay.tenant_id,
    auth.uid(),
    'upi.voided',
    'payments',
    pay.id,
    jsonb_build_object('invoice_id', pay.invoice_id, 'amount', pay.amount, 'tr', pay.transaction_ref)
  );

  return jsonb_build_object('payment_id', pay.id, 'status', pay.status);
end;
$$;

-- POS UPI stays pending until the cashier confirms the money arrived.
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
  pay public.payments;
  line jsonb;
  idx integer := 0;
  tr text;
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
  tr := 'BF' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);

  if p_method = 'upi' then
    insert into public.payments (
      tenant_id, invoice_id, amount, method, status, transaction_ref
    ) values (
      tid, inv.id, inv.total, 'upi_qr', 'pending', tr
    ) returning * into pay;
  else
    insert into public.payments (
      tenant_id, invoice_id, amount, method, status, tendered, change_amount, paid_at, transaction_ref
    ) values (
      tid,
      inv.id,
      inv.total,
      p_method,
      'succeeded',
      p_tendered,
      case when p_method = 'cash' and p_tendered is not null then greatest(p_tendered - inv.total, 0) else null end,
      now(),
      tr
    ) returning * into pay;
  end if;

  select * into inv from public.invoices where id = inv.id;
  return jsonb_build_object(
    'invoice_id', inv.id,
    'number', inv.number,
    'total', inv.total,
    'status', inv.status,
    'payment_id', pay.id,
    'payment_status', pay.status,
    'upi_tr', pay.transaction_ref
  );
end;
$$;

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
  pending public.payments;
begin
  select * into share from public.invoice_shares s
  where s.token = p_token and s.revoked_at is null and s.expires_at > now();
  if not found then
    return null;
  end if;
  select * into inv from public.invoices where id = share.invoice_id;
  select * into seller from public.tenants where id = inv.tenant_id;
  select * into buyer from public.customers where id = inv.customer_id;
  select * into pending from public.payments p
  where p.invoice_id = inv.id and p.method = 'upi_qr' and p.status = 'pending'
  order by p.created_at desc
  limit 1;
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
      'upi_vpa', seller.upi_vpa,
      'upi_payee_name', coalesce(seller.upi_payee_name, seller.legal_name, seller.name)
    ),
    'upi', case when pending.id is null or seller.upi_vpa is null then null else jsonb_build_object(
      'pa', seller.upi_vpa,
      'pn', coalesce(seller.upi_payee_name, seller.legal_name, seller.name),
      'am', pending.amount,
      'tn', left('Invoice ' || inv.number, 50),
      'tr', pending.transaction_ref
    ) end,
    'buyer', jsonb_build_object(
      'name', buyer.name,
      'gstin', buyer.gstin,
      'state_code', buyer.billing_state_code
    ),
    'items', lines
  );
end;
$$;

revoke all on function public.confirm_upi_payment(uuid, text) from public, anon;
revoke all on function public.void_upi_payment(uuid) from public, anon;
grant execute on function public.confirm_upi_payment(uuid, text) to authenticated, service_role;
grant execute on function public.void_upi_payment(uuid) to authenticated, service_role;
grant execute on function public.pos_checkout(uuid, jsonb, public.payment_method, public.supply_type, text, numeric)
  to authenticated, service_role;
grant execute on function public.get_shared_invoice(text) to anon, authenticated, service_role;
