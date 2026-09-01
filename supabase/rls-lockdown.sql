-- URGENT: Run this in Supabase → SQL Editor → Run (fixes rls_disabled_in_public)
-- PrintX uses DATABASE_URL on the Node server only — NOT the browser Data API.
-- Enabling RLS with no anon policies blocks public API access; your Render app still works.

alter table if exists users enable row level security;
alter table if exists sessions enable row level security;
alter table if exists schools enable row level security;
alter table if exists stands enable row level security;
alter table if exists products enable row level security;
alter table if exists custom_requests enable row level security;
alter table if exists contact_messages enable row level security;
alter table if exists website_settings enable row level security;

-- Belt-and-suspenders: deny Data API roles even if a policy is added later by mistake
revoke all on table users from anon, authenticated;
revoke all on table sessions from anon, authenticated;
revoke all on table schools from anon, authenticated;
revoke all on table stands from anon, authenticated;
revoke all on table products from anon, authenticated;
revoke all on table custom_requests from anon, authenticated;
revoke all on table contact_messages from anon, authenticated;
revoke all on table website_settings from anon, authenticated;
