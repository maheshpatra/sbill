-- Blank or padded GSTINs were stored as '' or with spaces, which fails
-- tenants_gstin_format / customers_gstin_format. Those checks stay as they are.
-- This only turns a blank value into null and uppercases the rest before the check runs.

create or replace function public.normalize_gstin_value(value text)
returns text
language sql
immutable
as $$
  select nullif(upper(btrim(value)), '');
$$;

create or replace function public.normalize_row_gstin()
returns trigger
language plpgsql
as $$
begin
  new.gstin := public.normalize_gstin_value(new.gstin);
  return new;
end;
$$;

drop trigger if exists tenants_normalize_gstin on public.tenants;
create trigger tenants_normalize_gstin
  before insert or update on public.tenants
  for each row execute function public.normalize_row_gstin();

drop trigger if exists customers_normalize_gstin on public.customers;
create trigger customers_normalize_gstin
  before insert or update on public.customers
  for each row execute function public.normalize_row_gstin();

update public.tenants
set gstin = public.normalize_gstin_value(gstin)
where gstin is distinct from public.normalize_gstin_value(gstin);

update public.customers
set gstin = public.normalize_gstin_value(gstin)
where gstin is distinct from public.normalize_gstin_value(gstin);
