-- PrintX: RLS lockdown (safe to re-run)
-- Use this ONLY if you already created tables WITHOUT the security block at the
-- bottom of schema.sql (Supabase alert: rls_disabled_in_public).
--
-- "Success, no rows returned" is correct. Tables and your data stay — you are
-- only locking the public API door. printx.pw still works via DATABASE_URL.

alter table if exists users enable row level security;
alter table if exists sessions enable row level security;
alter table if exists schools enable row level security;
alter table if exists stands enable row level security;
alter table if exists products enable row level security;
alter table if exists custom_requests enable row level security;
alter table if exists contact_messages enable row level security;
alter table if exists website_settings enable row level security;

revoke all on table users from anon, authenticated;
revoke all on table sessions from anon, authenticated;
revoke all on table schools from anon, authenticated;
revoke all on table stands from anon, authenticated;
revoke all on table products from anon, authenticated;
revoke all on table custom_requests from anon, authenticated;
revoke all on table contact_messages from anon, authenticated;
revoke all on table website_settings from anon, authenticated;
