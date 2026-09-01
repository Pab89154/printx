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
  created_at text not null
);

create table if not exists website_settings (
  key text primary key,
  value text not null,
  updated_at text not null
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
alter table website_settings enable row level security;

revoke all on table users from anon, authenticated;
revoke all on table sessions from anon, authenticated;
revoke all on table schools from anon, authenticated;
revoke all on table stands from anon, authenticated;
revoke all on table products from anon, authenticated;
revoke all on table custom_requests from anon, authenticated;
revoke all on table contact_messages from anon, authenticated;
revoke all on table website_settings from anon, authenticated;
