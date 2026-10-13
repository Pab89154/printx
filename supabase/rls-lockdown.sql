-- PrintX: RLS lockdown (safe to re-run)
-- Fixes Supabase advisor: rls_disabled_in_public
--
-- "Success, no rows returned" is correct. Tables and your data stay — you are
-- only locking the public Data API door. printx.pw still works via DATABASE_URL
-- (postgres / service role bypasses RLS).

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'users',
    'sessions',
    'schools',
    'stands',
    'products',
    'custom_requests',
    'contact_messages',
    'mail_messages',
    'mail_recipients',
    'website_settings',
    'pricing_settings',
    'printers',
    'designs',
    'orders',
    'order_items',
    'profit_ledger',
    'printer_settlements',
    'refund_requests',
    'discounts',
    'push_subscriptions'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', t);
    END IF;
  END LOOP;
END $$;
