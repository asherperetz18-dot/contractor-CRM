-- 0207: payment receipts emailed to the customer (DECISIONS #151).
--
-- Step 3 of full invoicing, the second half. When money arrives the
-- customer can be emailed a receipt: what was paid, for what, and what
-- is still owed. A payment made online gets one by itself once it
-- settles; a payment recorded by hand gets one when asked.
--
--   * portal_payments.receipt_sent_at: when the payment's receipt was
--     last emailed. The online receipt claims it before sending, so a
--     payment event delivered twice still sends one receipt.
--   * company_profile.receipt_emails_enabled: whether online payments
--     email a receipt. On for every company; switched off under
--     Settings > Portal Payments (for one whose payment account already
--     emails receipts, say).
--
-- Columns are added, nothing is removed: the running code ignores them.
-- Until this has run, nothing is receipted automatically; a receipt
-- asked for by hand still goes. Run in the Supabase SQL editor.

begin;

alter table public.portal_payments
  add column if not exists receipt_sent_at timestamptz;

comment on column public.portal_payments.receipt_sent_at is
  'When this payment''s receipt was last emailed to the customer. Null: never, or before 0207.';

alter table public.company_profile
  add column if not exists receipt_emails_enabled boolean not null default true;

comment on column public.company_profile.receipt_emails_enabled is
  'Email the customer a receipt when they pay online (DECISIONS #151).';

commit;

-- Check: should read true.
select
  (select count(*) from information_schema.columns
    where table_schema = 'public'
      and ((table_name = 'portal_payments' and column_name = 'receipt_sent_at')
        or (table_name = 'company_profile' and column_name = 'receipt_emails_enabled'))) = 2
  as payment_receipts_ready;
