-- PrintX schema for Supabase Postgres
-- Run ONCE in Supabase → SQL Editor → New query → Run.
-- "Success, no rows returned" is normal — tables stay visible; that is correct.
--
-- After this: set DATABASE_URL (Session pooler URI) on Render + local .env.
-- PrintX uses Vite + Node with DATABASE_URL only — NOT @supabase/ssr or the Data API.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists users (
  id text primary key,
  email text,
  password_hash text not null,
  role text not null default 'admin',
  email_verified integer not null default 1,
  permissions text,
  display_name text,
  mail_signature text not null default '',
  cloud_slicer_token text not null default '',
  cloud_slicer_printer_id text not null default '',
  cloud_slicer_filament_id text not null default '',
  cloud_slicer_configured_at text,
  created_at text not null
);

-- If users already exists without newer columns:
-- alter table users add column if not exists permissions text;
-- alter table users add column if not exists display_name text;
-- alter table users add column if not exists mail_signature text not null default '';

create unique index if not exists users_email_lower_idx on users (lower(email));

create table if not exists sessions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at text not null,
  created_at text not null
);

create table if not exists schools (
  id text primary key,
  name text not null,
  address text not null default '',
  description text not null default '',
  image text not null default '',
  active integer not null default 1,
  created_at text not null,
  updated_at text not null
);

create table if not exists stands (
  id text primary key,
  school_id text references schools(id) on delete set null,
  school_name text not null,
  date text not null,
  start_time text not null,
  end_time text not null,
  location text not null,
  description text not null default '',
  notes text not null default '',
  products_json text not null default '[]',
  status text not null default 'upcoming',
  created_at text not null,
  updated_at text not null
);

create table if not exists products (
  id text primary key,
  name text not null,
  description text not null default '',
  price double precision not null default 0,
  category text not null default 'General',
  image text not null default '',
  emoji text not null default 'package',
  image_gradient text not null default 'from-navy to-electric',
  available integer not null default 1,
  featured integer not null default 0,
  display_order integer not null default 0,
  created_at text not null,
  updated_at text not null
);

create table if not exists custom_requests (
  id text primary key,
  name text not null,
  email text not null,
  school text not null default '',
  description text not null default '',
  size text not null default '',
  uploaded_file text,
  status text not null default 'new',
  created_at text not null,
  updated_at text not null
);

create table if not exists contact_messages (
  id text primary key,
  name text not null,
  email text not null,
  inquiry_type text not null default '',
  message text not null,
  status text not null default 'new',
  created_at text not null
);

create table if not exists mail_messages (
  id text primary key,
  sender_id text not null references users(id) on delete cascade,
  subject text not null default '',
  body text not null default '',
  created_at text not null,
  sender_deleted_at text,
  scheduled_at text
);

create table if not exists mail_recipients (
  id text primary key,
  message_id text not null references mail_messages(id) on delete cascade,
  recipient_id text not null references users(id) on delete cascade,
  read_at text,
  archived_at text,
  deleted_at text,
  unique (message_id, recipient_id)
);

-- Existing projects:
-- alter table mail_recipients add column if not exists archived_at text;
-- alter table mail_recipients add column if not exists deleted_at text;
-- alter table mail_messages add column if not exists sender_deleted_at text;
-- alter table mail_messages add column if not exists scheduled_at text;

create table if not exists website_settings (
  key text primary key,
  value text not null,
  updated_at text not null
);

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

-- ---------------------------------------------------------------------------
-- Security (required on Supabase)
-- The Node server connects with DATABASE_URL (postgres role) and bypasses RLS.
-- RLS + revokes block the public Data API (anon / publishable key).
-- Do NOT add permissive policies for anon — PrintX does not use client-side Supabase.
-- ---------------------------------------------------------------------------

alter table users enable row level security;
alter table sessions enable row level security;
alter table schools enable row level security;
alter table stands enable row level security;
alter table products enable row level security;
alter table custom_requests enable row level security;
alter table contact_messages enable row level security;
alter table mail_messages enable row level security;
alter table mail_recipients enable row level security;
alter table website_settings enable row level security;
alter table pricing_settings enable row level security;
alter table printers enable row level security;
alter table designs enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table profit_ledger enable row level security;

revoke all on table users from anon, authenticated;
revoke all on table sessions from anon, authenticated;
revoke all on table schools from anon, authenticated;
revoke all on table stands from anon, authenticated;
revoke all on table products from anon, authenticated;
revoke all on table custom_requests from anon, authenticated;
revoke all on table contact_messages from anon, authenticated;
revoke all on table mail_messages from anon, authenticated;
revoke all on table mail_recipients from anon, authenticated;
revoke all on table website_settings from anon, authenticated;
revoke all on table pricing_settings from anon, authenticated;
revoke all on table printers from anon, authenticated;
revoke all on table designs from anon, authenticated;
revoke all on table orders from anon, authenticated;
revoke all on table order_items from anon, authenticated;
revoke all on table profit_ledger from anon, authenticated;
