-- 0206: when a bill was last sent to the customer, and how
-- (DECISIONS #150).
--
-- Step 3 of full invoicing. A bill (an invoice, or a billed stage of a
-- contract) can now go out by text, by email, or both. Nothing recorded
-- that it went out at all: a bill texted to the customer and one only
-- marked billed looked the same, so the Invoices page could only say
-- "Billed" for both. These record the latest send, so it can say "Sent".
--
-- Columns are added, nothing is removed: the running code ignores them,
-- and the new code still bills where they're missing -- it just can't
-- say Sent until this has run. Run in the Supabase SQL editor.

begin;

alter table public.estimate_payments
  add column if not exists sent_at timestamptz;

alter table public.estimate_payments
  add column if not exists sent_via text
    check (sent_via is null or sent_via in ('text', 'email', 'text+email'));

comment on column public.estimate_payments.sent_at is
  'When this bill was last sent to the customer (text and/or email). Null: billed without a send, or before 0206.';
comment on column public.estimate_payments.sent_via is
  'How the last send went out: text, email or text+email.';

commit;

-- Check: should read true.
select
  (select count(*) from information_schema.columns
    where table_schema = 'public'
      and table_name = 'estimate_payments'
      and column_name in ('sent_at', 'sent_via')) = 2
  as bill_sends_ready;
