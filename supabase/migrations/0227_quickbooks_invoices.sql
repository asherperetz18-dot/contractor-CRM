-- 0227: QuickBooks, step 3 -- invoices and customer payments go to
-- QuickBooks (DECISIONS #183).
--
-- Once a company turns it on (Settings › QuickBooks › Send invoices to
-- QuickBooks), each bill to a customer dated from its start date goes to
-- its QuickBooks Online as an invoice: each issued invoice, each billed
-- stage of a contract or change order, and each contract's deposit. Each
-- payment that comes in goes as a payment on that invoice; a credit as a
-- credit memo on it; a refund the customer doesn't owe back as a refund.
-- The customer is found in QuickBooks by name or added, and each signed
-- contract becomes a job (sub-customer) under it. Only what the CRM sent
-- is ever changed.
--
--   * quickbooks_connections: the switch and start date (separate from
--     bills'), when the job last looked and its claim, the products or
--     services and accounts picked, whether customers invoiced outside the
--     CRM are left out, and QuickBooks' own settings and products as last
--     read.
--   * quickbooks_sync keeps a row for each customer, job, invoice, deposit
--     invoice, payment, credit (and the $0.00 payment that applies it) and
--     refund, the same way it does for bills.
--
-- Columns are added and the list of record types grows; nothing is
-- removed. Run in the Supabase SQL editor, after 0222 and 0223. Safe to
-- run twice.

begin;

alter table public.quickbooks_connections
  add column if not exists send_invoices boolean not null default false,
  add column if not exists send_invoices_from date,
  add column if not exists invoices_checked_at timestamptz,
  add column if not exists invoices_claimed_until timestamptz,
  -- QuickBooks products or services: job work, and (null = the same) deposits and costs billed back.
  add column if not exists invoice_item_id text,
  add column if not exists deposit_item_id text,
  add column if not exists cost_item_id text,
  -- Where customer payments go (null = QuickBooks' Payments to deposit), and where refunds come from.
  add column if not exists payments_account_id text,
  add column if not exists stripe_refunds_account_id text,
  add column if not exists hand_refunds_account_id text,
  -- Customers whose online payments are off are invoiced outside the CRM: left out unless this is on.
  add column if not exists send_outside_crm boolean not null default false,
  -- QuickBooks' products or services, and its settings, as last read.
  add column if not exists items jsonb,
  add column if not exists items_read_at timestamptz,
  add column if not exists qb_prefs jsonb,
  add column if not exists qb_prefs_read_at timestamptz;

alter table public.quickbooks_sync drop constraint if exists quickbooks_sync_record_type_check;
alter table public.quickbooks_sync
  add constraint quickbooks_sync_record_type_check check (record_type in (
    'bill', 'bill_payment', 'receipt',
    'customer', 'job', 'invoice', 'deposit', 'customer_payment', 'credit', 'credit_link', 'refund'
  ));

comment on table public.quickbooks_sync is
  'What the CRM sent to each company''s QuickBooks, record by record: bills, bill payments and receipts (DECISIONS #173, #174), customers, jobs, invoices, payments, credits and refunds (#183). Server writes only.';

commit;

-- Check: should read true.
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'quickbooks_connections'
      and column_name in ('send_invoices', 'send_invoices_from', 'invoices_checked_at', 'invoices_claimed_until',
                          'invoice_item_id', 'deposit_item_id', 'cost_item_id', 'payments_account_id',
                          'stripe_refunds_account_id', 'hand_refunds_account_id', 'send_outside_crm',
                          'items', 'items_read_at', 'qb_prefs', 'qb_prefs_read_at')) = 15
  and exists (
    select 1 from pg_constraint
    where conrelid = 'public.quickbooks_sync'::regclass
      and conname = 'quickbooks_sync_record_type_check'
      and pg_get_constraintdef(oid) like '%customer_payment%'
  ) as quickbooks_invoices_ready;
