-- PrintX model / upload files (private bucket).
-- Run once in Supabase SQL Editor after schema.sql.
-- The Node server also auto-creates this bucket when SUPABASE_SERVICE_ROLE_KEY is set.

insert into storage.buckets (id, name, public, file_size_limit)
values ('printx-models', 'printx-models', false, 52428800)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit;

-- No anon/authenticated policies — only the service role (PrintX server) reads/writes.
-- Objects are stored as: uploads/<uuid>.<ext>
