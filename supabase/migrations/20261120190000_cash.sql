-- Cash tender on every plan. amount_tendered is what the customer handed over.
-- change_given is what the cashier handed back, and may be less than the extra.
-- recorded_by is the cashier. Cash is not gated.

alter table public.payments
  add column if not exists amount_tendered numeric(12, 2),
  add column if not exists change_given numeric(12, 2),
  add column if not exists recorded_by uuid references public.users (id) on delete set null;

alter table public.payments drop constraint if exists payments_cash_nonnegative;
alter table public.payments
  add constraint payments_cash_nonnegative check (
    (amount_tendered is null or amount_tendered >= 0)
    and (change_given is null or change_given >= 0)
  );

insert into public.features (key, name, description) values
  ('cash_payments', 'Cash', 'Record cash with the amount received and the change given')
on conflict (key) do update set name = excluded.name, description = excluded.description;

insert into public.plan_features (plan_id, feature_key, enabled, limit_value)
select p.id, 'cash_payments', true, null
from public.plans p
on conflict (plan_id, feature_key) do update set enabled = true;

update public.plans
set features = jsonb_set(features, '{cash_payments}', 'true'::jsonb, true);

drop function if exists public.pos_checkout(uuid, jsonb, public.payment_method, public.supply_type, text, numeric);

create or replace function public.pos_checkout(
  p_customer_id uuid,
  p_lines jsonb,
  p_method public.payment_method,
  p_supply public.supply_type,
  p_place text,
  p_tendered numeric default null,
  p_change numeric default null
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
  change_due numeric(12, 2);
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
      tenant_id, invoice_id, amount, method, status, transaction_ref, recorded_by
    ) values (
      tid, inv.id, inv.total, 'upi_qr', 'pending', tr, uid
    ) returning * into pay;
  elsif p_method = 'cash' then
    if p_tendered is null or p_tendered + 0.001 < inv.total then
      raise exception 'cash received must cover the amount due' using errcode = '22023';
    end if;
    change_due := round(p_tendered - inv.total, 2);
    if p_change is not null and (p_change < 0 or p_change > change_due + 0.001) then
      raise exception 'change cannot be more than the extra cash' using errcode = '22023';
    end if;
    insert into public.payments (
      tenant_id, invoice_id, amount, method, status,
      tendered, change_amount, amount_tendered, change_given,
      paid_at, transaction_ref, recorded_by
    ) values (
      tid, inv.id, inv.total, 'cash', 'succeeded',
      p_tendered, coalesce(p_change, change_due), p_tendered, coalesce(p_change, change_due),
      now(), tr, uid
    ) returning * into pay;
  else
    insert into public.payments (
      tenant_id, invoice_id, amount, method, status, paid_at, transaction_ref, recorded_by
    ) values (
      tid, inv.id, inv.total, p_method, 'succeeded', now(), tr, uid
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
    'upi_tr', pay.transaction_ref,
    'amount_tendered', pay.amount_tendered,
    'change_given', pay.change_given
  );
end;
$$;

grant execute on function public.pos_checkout(uuid, jsonb, public.payment_method, public.supply_type, text, numeric, numeric)
  to authenticated, service_role;
