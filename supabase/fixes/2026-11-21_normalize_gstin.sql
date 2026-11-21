-- Paste into the Supabase SQL editor. Safe to run more than once.
-- Does not change tenants_gstin_format or customers_gstin_format.
-- Blank GSTINs become null. Other values are trimmed and uppercased before the check.

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
