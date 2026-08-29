-- PrintX schema for Supabase Postgres
-- Run this once in Supabase → SQL Editor (Dashboard → SQL → New query → Run).
-- After tables exist, set DATABASE_URL (Session pooler URI) on Render + local .env.
-- The Node server also runs CREATE TABLE IF NOT EXISTS on boot, but running this
-- file first is the clearest setup path.

create table if not exists users (
  id text primary key,
  email text,
  password_hash text not null,
  role text not null default 'admin',
  email_verified integer not null default 1,
  created_at text not null
);

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
  image_gradient text not null default 'from-blue-500 to-cyan-400',
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
  created_at text not null
);

create table if not exists website_settings (
  key text primary key,
  value text not null,
  updated_at text not null
);

-- Server uses DATABASE_URL (postgres role) which bypasses RLS.
-- Enable RLS with no anon/authenticated policies so the Data API cannot
-- read/write these tables if someone has the publishable key.
alter table users enable row level security;
alter table sessions enable row level security;
alter table schools enable row level security;
alter table stands enable row level security;
alter table products enable row level security;
alter table custom_requests enable row level security;
alter table contact_messages enable row level security;
alter table website_settings enable row level security;
