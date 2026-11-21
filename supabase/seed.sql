-- Billflow demo data.
-- Run after the migrations, in the Supabase SQL editor or via psql.
-- Does not insert auth.users. Membership rows are omitted on purpose so this
-- file succeeds on a hosted project before anyone has signed up.
-- Safe to run more than once (fixed primary keys, ON CONFLICT DO NOTHING).

-- Acme Traders, Pune (Growth). Northwind Studios, Bengaluru (Starter).
-- Saffron Retail, Jaipur (Business). Plain Goods, Indore (Free).

insert into public.tenants (
  id, name, legal_name, slug, plan, status, gstin, email, phone,
  address_line1, city, state, state_code, pincode, country,
  upi_vpa, invoice_prefix, currency, timezone
) values
  (
    '20000000-0000-4000-8000-000000000001',
    'Acme Traders',
    'Acme Traders Pvt Ltd',
    'acme',
    'growth',
    'active',
    '27AAAAA0000A1Z5',
    'billing@acmetraders.example',
    '+91 20 4000 1001',
    '14 FC Road',
    'Pune',
    'Maharashtra',
    '27',
    '411004',
    'IN',
    'acme@okhdfcbank',
    'INV',
    'INR',
    'Asia/Kolkata'
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    'Northwind Studios',
    'Northwind Studios',
    'northwind',
    'starter',
    'trialing',
    '29BBBBB0000B1Z8',
    'hello@northwind.example',
    '+91 80 4000 2002',
    '22 Residency Road',
    'Bengaluru',
    'Karnataka',
    '29',
    '560025',
    'IN',
    'northwind@okaxis',
    'INV',
    'INR',
    'Asia/Kolkata'
  ),
  (
    '20000000-0000-4000-8000-000000000003',
    'Saffron Retail',
    'Saffron Retail LLP',
    'saffron',
    'business',
    'active',
    '08CCCCC0000C1Z2',
    'accounts@saffronretail.example',
    '+91 141 400 3003',
    '8 MI Road',
    'Jaipur',
    'Rajasthan',
    '08',
    '302001',
    'IN',
    'saffron@ybl',
    'INV',
    'INR',
    'Asia/Kolkata'
  ),
  (
    '20000000-0000-4000-8000-000000000004',
    'Plain Goods',
    'Plain Goods',
    'plain',
    'free',
    'trialing',
    null,
    'hello@plaingoods.example',
    '+91 731 400 4004',
    '2 MG Road',
    'Indore',
    'Madhya Pradesh',
    '23',
    '452001',
    'IN',
    null,
    'INV',
    'INR',
    'Asia/Kolkata'
  )
on conflict (id) do nothing;

insert into public.invoice_counters (tenant_id, prefix, next_number, pad) values
  ('20000000-0000-4000-8000-000000000001', 'INV', 4, 4),
  ('20000000-0000-4000-8000-000000000002', 'INV', 2, 4),
  ('20000000-0000-4000-8000-000000000003', 'INV', 8, 4)
on conflict (tenant_id) do update
  set next_number = greatest(public.invoice_counters.next_number, excluded.next_number);

insert into public.tax_rates (id, tenant_id, name, rate, tax_type, is_default) values
  ('50000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000001', 'GST 18%', 18, 'gst', true),
  ('50000000-0000-4000-8000-000000000012', '20000000-0000-4000-8000-000000000001', 'GST 5%', 5, 'gst', false),
  ('50000000-0000-4000-8000-000000000021', '20000000-0000-4000-8000-000000000002', 'GST 18%', 18, 'gst', true),
  ('50000000-0000-4000-8000-000000000031', '20000000-0000-4000-8000-000000000003', 'GST 5%', 5, 'gst', true),
  ('50000000-0000-4000-8000-000000000032', '20000000-0000-4000-8000-000000000003', 'GST 18%', 18, 'gst', false)
on conflict (id) do nothing;

insert into public.customers (
  id, tenant_id, name, email, phone, company, gstin, billing_address, currency, notes
) values
  (
    '30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'Mehta & Co',
    'accounts@mehtaco.example',
    '+91 22 4000 1111',
    'Mehta & Co',
    '27DDDDD0000D1Z1',
    '{"line1":"201 Nariman Point","city":"Mumbai","state":"Maharashtra","state_code":"27","pincode":"400021","country":"IN"}'::jsonb,
    'INR',
    'Retainer client since 2024.'
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000001',
    'Blue Lotus Designs',
    'pay@bluelotus.example',
    '+91 20 4000 2222',
    'Blue Lotus Designs',
    null,
    '{"line1":"9 Law College Road","city":"Pune","state":"Maharashtra","state_code":"27","pincode":"411004","country":"IN"}'::jsonb,
    'INR',
    null
  ),
  (
    '30000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000002',
    'Harbor Coffee Roasters',
    'finance@harborcoffee.example',
    '+91 80 4000 3333',
    'Harbor Coffee Roasters',
    '33EEEEE0000E1Z9',
    '{"line1":"4 Beach Road","city":"Chennai","state":"Tamil Nadu","state_code":"33","pincode":"600001","country":"IN"}'::jsonb,
    'INR',
    'Inter-state supply. Charge IGST.'
  ),
  (
    '30000000-0000-4000-8000-000000000004',
    '20000000-0000-4000-8000-000000000003',
    'Jaipur Textiles',
    'ap@jaipurtextiles.example',
    '+91 141 400 4444',
    'Jaipur Textiles',
    '08FFFFF0000F1Z6',
    '{"line1":"12 Bapu Bazaar","city":"Jaipur","state":"Rajasthan","state_code":"08","pincode":"302001","country":"IN"}'::jsonb,
    'INR',
    null
  )
on conflict (id) do nothing;

insert into public.subscriptions (
  id, tenant_id, plan_id, plan_name, price, currency, billing_cycle, status,
  start_date, current_period_start, current_period_end, provider
) values
  (
    '60000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    'Growth',
    499,
    'INR',
    'monthly',
    'active',
    current_date - 40,
    current_date - 10,
    current_date + 20,
    'manual'
  ),
  (
    '60000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    'Starter',
    0,
    'INR',
    'monthly',
    'trialing',
    current_date - 3,
    current_date - 3,
    current_date + 11,
    'manual'
  ),
  (
    '60000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000003',
    'Business',
    14990,
    'INR',
    'yearly',
    'active',
    current_date - 100,
    current_date - 100,
    current_date + 265,
    'manual'
  ),
  (
    '60000000-0000-4000-8000-000000000004',
    '20000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000000',
    'Free',
    0,
    'INR',
    'monthly',
    'trialing',
    current_date,
    current_date,
    current_date + 14,
    'manual'
  )
on conflict (id) do nothing;

insert into public.sites (id, tenant_id, custom_domain, published, title, tagline, about, theme) values
  (
    '70000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    null,
    true,
    'Acme Traders',
    'Wholesale supply, invoiced properly.',
    'Acme Traders bills in INR with GST. Pay by UPI to acme@okhdfcbank.',
    '{"accent":"#0f766e"}'::jsonb
  ),
  (
    '70000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000002',
    null,
    false,
    'Northwind Studios',
    'Brand and packaging studio.',
    'Site is still a draft.',
    '{"accent":"#1d4ed8"}'::jsonb
  ),
  (
    '70000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000003',
    'pay.saffronretail.in',
    true,
    'Saffron Retail',
    'Textiles from Jaipur.',
    'Pay invoices on our site.',
    '{"accent":"#b45309"}'::jsonb
  )
on conflict (id) do nothing;

-- Subdomains come from the slug via the tenant insert trigger. Pin them anyway.
update public.tenants
   set subdomain = slug
 where id in (
   '20000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000002',
   '20000000-0000-4000-8000-000000000003'
 );

insert into public.tenant_template_settings (
  tenant_id, template_id, overrides, published_overrides, published_at
) values
  (
    '20000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000001',
    '{"title":"Acme Traders","tagline":"Wholesale supply, invoiced properly.","about":"Acme Traders bills in INR with GST.","colors":{"accent":"#0f766e"}}'::jsonb,
    '{"title":"Acme Traders","tagline":"Wholesale supply, invoiced properly.","about":"Acme Traders bills in INR with GST. Pay by UPI to acme@okhdfcbank.","colors":{"accent":"#0f766e"}}'::jsonb,
    now()
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    '71000000-0000-4000-8000-000000000003',
    '{"title":"Northwind Studios","tagline":"Brand and packaging studio.","about":"Site is still a draft."}'::jsonb,
    null,
    null
  ),
  (
    '20000000-0000-4000-8000-000000000003',
    '71000000-0000-4000-8000-000000000002',
    '{"title":"Saffron Retail","tagline":"Textiles from Jaipur.","about":"Pay invoices on our site.","colors":{"accent":"#b45309"}}'::jsonb,
    '{"title":"Saffron Retail","tagline":"Textiles from Jaipur.","about":"Pay invoices on our site.","colors":{"accent":"#b45309"}}'::jsonb,
    now()
  )
on conflict (tenant_id) do update
  set template_id = excluded.template_id,
      overrides = excluded.overrides,
      published_overrides = excluded.published_overrides,
      published_at = excluded.published_at;

insert into public.tenant_domains (
  id, tenant_id, domain, verified, verification_token, ssl_status, is_primary
) values (
  '72000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000003',
  'pay.saffronretail.in',
  true,
  'billflow-verify=seed-token-not-secret-public',
  'active',
  true
)
on conflict (id) do nothing;

-- Draft first so line triggers can run, then move issued invoices to sent.
insert into public.invoices (
  id, tenant_id, customer_id, number, status, supply_type, place_of_supply,
  currency, issued_at, due_at, notes, terms
) values
  (
    '40000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'INV-0001',
    'draft',
    'intra',
    '27',
    'INR',
    now() - interval '12 days',
    now() - interval '2 days',
    'April retainer and filing.',
    'Payable within 10 days. UPI: acme@okhdfcbank.'
  ),
  (
    '40000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000002',
    'INV-0002',
    'draft',
    'intra',
    '27',
    'INR',
    now() - interval '2 days',
    now() + interval '13 days',
    'Packaging samples.',
    'GST extra as shown.'
  ),
  (
    '40000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'INV-0003',
    'draft',
    'intra',
    '27',
    'INR',
    now() - interval '30 days',
    now() - interval '10 days',
    'Overdue on purpose so the cron has something to find if it is reset to sent.',
    'Please clear the outstanding balance.'
  ),
  (
    '40000000-0000-4000-8000-000000000004',
    '20000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000003',
    'INV-0001',
    'draft',
    'inter',
    '33',
    'INR',
    null,
    null,
    'Draft brand retainer. Not sent.',
    null
  ),
  (
    '40000000-0000-4000-8000-000000000005',
    '20000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000004',
    'INV-0007',
    'draft',
    'intra',
    '08',
    'INR',
    now() - interval '6 days',
    now() + interval '8 days',
    'Handloom lot, March.',
    'UPI: saffron@ybl'
  )
on conflict (id) do nothing;

insert into public.invoice_items (
  id, tenant_id, invoice_id, description, quantity, unit_price, tax_rate_id, tax_rate, hsn_sac, sort_order
) values
  (
    '41000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    'Monthly bookkeeping retainer',
    2, 10000,
    '50000000-0000-4000-8000-000000000011',
    18, '9982', 1
  ),
  (
    '41000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000002',
    'Carton design and dieline',
    1, 5000,
    '50000000-0000-4000-8000-000000000011',
    18, '9983', 1
  ),
  (
    '41000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000003',
    'GST return filing (GSTR-1 + 3B)',
    3, 2500,
    '50000000-0000-4000-8000-000000000011',
    18, '9982', 1
  ),
  (
    '41000000-0000-4000-8000-000000000004',
    '20000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000004',
    'Brand retainer',
    1, 8000,
    '50000000-0000-4000-8000-000000000021',
    18, '9983', 1
  ),
  (
    '41000000-0000-4000-8000-000000000005',
    '20000000-0000-4000-8000-000000000003',
    '40000000-0000-4000-8000-000000000005',
    'Handloom cotton, dyed',
    4, 1500,
    '50000000-0000-4000-8000-000000000031',
    5, '5208', 1
  )
on conflict (id) do nothing;

update public.invoices
   set status = 'sent'
 where id in (
   '40000000-0000-4000-8000-000000000001',
   '40000000-0000-4000-8000-000000000002',
   '40000000-0000-4000-8000-000000000003',
   '40000000-0000-4000-8000-000000000005'
 )
   and status = 'draft';

update public.invoices
   set status = 'overdue'
 where id = '40000000-0000-4000-8000-000000000003'
   and status = 'sent';

insert into public.payments (
  id, tenant_id, invoice_id, amount, method, status, transaction_ref, notes, paid_at
)
select
  '80000000-0000-4000-8000-000000000001',
  i.tenant_id,
  i.id,
  i.total,
  'upi'::public.payment_method,
  'succeeded'::public.payment_status,
  'UPI-ACME-INV-0001',
  'Paid in full via UPI',
  now() - interval '1 day'
from public.invoices i
where i.id = '40000000-0000-4000-8000-000000000001'
  and not exists (
    select 1 from public.payments p
    where p.id = '80000000-0000-4000-8000-000000000001'
  );

insert into public.payments (
  id, tenant_id, invoice_id, amount, method, status, transaction_ref, notes, paid_at
)
select
  '80000000-0000-4000-8000-000000000002',
  i.tenant_id,
  i.id,
  i.total,
  'upi'::public.payment_method,
  'succeeded'::public.payment_status,
  'UPI-SAFFRON-INV-0007',
  'Collected at the counter',
  now() - interval '5 days'
from public.invoices i
where i.id = '40000000-0000-4000-8000-000000000005'
  and not exists (
    select 1 from public.payments p
    where p.id = '80000000-0000-4000-8000-000000000002'
  );

insert into public.webhook_endpoints (
  id, tenant_id, url, secret, events, description
) values (
  '90000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000003',
  'https://example.com/hooks/billflow',
  'saffron-demo-secret-key',
  array['invoice.paid', 'invoice.sent'],
  'Demo endpoint. Nothing is delivered by the seed.'
)
on conflict (id) do nothing;

update public.customers set billing_state_code = '27'
 where id in ('30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002');
update public.customers set billing_state_code = '33'
 where id = '30000000-0000-4000-8000-000000000003';
update public.customers set billing_state_code = '08'
 where id = '30000000-0000-4000-8000-000000000004';

insert into public.products (id, tenant_id, name, sku, barcode, hsn_sac, unit, price, gst_rate, stock) values
  ('73000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Basmati rice 5kg', 'RICE-5', '8901000000011', '1006', 'BAG', 450, 5, 40),
  ('73000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'Toor dal 1kg', 'DAL-1', '8901000000028', '0713', 'KG', 160, 5, 25),
  ('73000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000003', 'Cotton stole', 'STOLE', '8902000000035', '6214', 'NOS', 899, 5, 12)
on conflict (id) do nothing;

insert into public.pos_settings (tenant_id, default_tax_rate, receipt_footer, paper_width) values
  ('20000000-0000-4000-8000-000000000001', 5, 'Thank you for shopping at Acme Traders.', 80),
  ('20000000-0000-4000-8000-000000000003', 5, 'Saffron Retail, Jaipur.', 58)
on conflict (tenant_id) do nothing;

insert into public.reminder_schedules (id, tenant_id, offset_days, channel, template) values
  ('74000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', -3, 'whatsapp', 'Hello {{customer_name}}, invoice {{number}} for {{total}} is due on {{due_date}}.'),
  ('74000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 0, 'email', 'Invoice {{number}} is due today. Amount {{total}}.'),
  ('74000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', 3, 'sms', 'Reminder: {{number}} is overdue. Please pay {{total}}.'),
  ('74000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001', 7, 'whatsapp', '{{customer_name}}, {{number}} is 7 days overdue.'),
  ('74000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000001', 14, 'email', 'Final reminder for {{number}}.')
on conflict (id) do nothing;

insert into public.invoice_shares (id, tenant_id, invoice_id, token, expires_at) values (
  '75000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000002',
  'share-acme-inv-0002-public-token',
  now() + interval '30 days'
)
on conflict (id) do nothing;
