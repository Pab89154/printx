-- Custom print Cloud Slicer quotes / pricing (safe to re-run).
alter table custom_requests add column if not exists slice_status text not null default 'idle';
alter table custom_requests add column if not exists slice_error text not null default '';
alter table custom_requests add column if not exists grams_pablo_p1s double precision;
alter table custom_requests add column if not exists hours_pablo_p1s double precision;
alter table custom_requests add column if not exists grams_court_ender double precision;
alter table custom_requests add column if not exists hours_court_ender double precision;
alter table custom_requests add column if not exists grams_josh_kobra double precision;
alter table custom_requests add column if not exists hours_josh_kobra double precision;
alter table custom_requests add column if not exists quote_ids_json text not null default '{}';
alter table custom_requests add column if not exists file_ids_json text not null default '{}';
alter table custom_requests add column if not exists worst_printer_id text;
alter table custom_requests add column if not exists worst_cost_usd double precision;
alter table custom_requests add column if not exists catalog_price_usd double precision;
alter table custom_requests add column if not exists quoted_at text;
alter table custom_requests add column if not exists stripe_session_id text;
alter table custom_requests add column if not exists paid_at text;
