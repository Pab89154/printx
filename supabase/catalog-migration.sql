-- Run once in Supabase SQL Editor if PrintX tables already exist
-- and you need the catalog / orders tables added.

create table if not exists pricing_settings (
  id text primary key,
  filament_usd_per_gram double precision not null default 0.0289,
  electricity_usd_per_kwh double precision not null default 0.15,
  margin_pct double precision not null default 0.5,
  unproductive_adder_usd double precision not null default 0.2,
  fixing_adder_usd double precision not null default 0.05,
  sales_tax_pct double precision not null default 0,
  custom_colors_json text not null default '[]',
  updated_at text not null,
  updated_by text
);

create table if not exists printers (
  id text primary key,
  owner_label text not null,
  model_name text not null,
  avg_power_kw double precision not null default 0.2,
  active integer not null default 1,
  owner_user_id text references users(id) on delete set null
);

create table if not exists designs (
  id text primary key,
  sku_base text not null unique,
  name text not null,
  description text not null default '',
  category text not null default 'General',
  image_url text not null default '',
  stl_path text not null default '',
  slice_status text not null default 'idle',
  slice_error text not null default '',
  status text not null default 'draft',
  created_by text references users(id) on delete set null,
  submitted_at text,
  reviewed_by text references users(id) on delete set null,
  reviewed_at text,
  review_note text not null default '',
  grams_pablo_p1s double precision,
  hours_pablo_p1s double precision,
  grams_court_ender double precision,
  hours_court_ender double precision,
  grams_josh_kobra double precision,
  hours_josh_kobra double precision,
  available_color_ids text not null default '[]',
  worst_cost_usd double precision,
  catalog_price_usd double precision,
  priced_at text,
  pricing_inputs_json text not null default '{}',
  created_at text not null,
  updated_at text not null
);

-- Additive columns for existing PrintX DBs
alter table users add column if not exists cloud_slicer_token text not null default '';
alter table users add column if not exists cloud_slicer_printer_id text not null default '';
alter table users add column if not exists cloud_slicer_filament_id text not null default '';
alter table users add column if not exists cloud_slicer_configured_at text;
alter table designs add column if not exists stl_path text not null default '';
alter table designs add column if not exists slice_status text not null default 'idle';
alter table designs add column if not exists slice_error text not null default '';

create table if not exists orders (
  id text primary key,
  customer_name text not null default '',
  customer_email text not null default '',
  status text not null default 'pending_payment',
  stripe_session_id text,
  stripe_payment_intent text,
  subtotal_usd double precision not null default 0,
  total_usd double precision not null default 0,
  currency text not null default 'usd',
  created_at text not null,
  updated_at text not null,
  paid_at text
);

create table if not exists order_items (
  id text primary key,
  order_id text not null references orders(id) on delete cascade,
  design_id text not null references designs(id) on delete restrict,
  sku text not null,
  color_id text not null,
  color_name text not null default '',
  qty integer not null default 1,
  unit_price_usd double precision not null default 0,
  worst_cost_unit_usd double precision not null default 0,
  line_total_usd double precision not null default 0,
  print_status text not null default 'unclaimed',
  assigned_printer_id text,
  assigned_admin_user_id text references users(id) on delete set null,
  claimed_at text,
  completed_at text,
  reimburse_usd double precision,
  profit_usd double precision
);

create table if not exists profit_ledger (
  id text primary key,
  order_item_id text not null references order_items(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  entry_type text not null,
  amount_usd double precision not null,
  note text not null default '',
  created_at text not null
);

alter table pricing_settings enable row level security;
alter table printers enable row level security;
alter table designs enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table profit_ledger enable row level security;

revoke all on table pricing_settings from anon, authenticated;
revoke all on table printers from anon, authenticated;
revoke all on table designs from anon, authenticated;
revoke all on table orders from anon, authenticated;
revoke all on table order_items from anon, authenticated;
revoke all on table profit_ledger from anon, authenticated;
