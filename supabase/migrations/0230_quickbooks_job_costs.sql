-- 0230: QuickBooks, step 4 -- lender fees go to QuickBooks as expenses
-- (DECISIONS #199).
--
-- Once a company turns it on (Settings › QuickBooks › Send job costs to
-- QuickBooks), each lender fee the Funded step saves (#169) dated from its
-- start date goes to its QuickBooks Online as an Expense on the job: paid
-- out of the bank account lenders pay into, to the lender, in the account
-- matched to "Financing fee", not billable, with its receipt if it has one.
-- A change in the CRM follows; a fee deleted with Edit is deleted there.
-- Other "Already paid" job costs from the start date are to be entered by
-- hand: the CRM never recorded what paid for them. Only what the CRM sent
-- is ever changed.
--
--   * quickbooks_connections: the switch and start date (apart from bills'
--     and invoices'), when the job last looked and its claim, and the bank
--     account lender payouts land in (null: not picked, fees wait).
--   * job_expenses.lender_fee: marks a lender's fee. Set by Funded; the fees
--     already saved (since 2026-10-07 15:50:58 UTC, PR #404) are marked here.
--     Only the server sets or changes it: a signed-in person's insert or
--     change through the API can't (a trigger keeps it as it was). A
--     'manual' "Financing fee" cost from after that moment that the server
--     inserts without it (a build from before this file, or a contact
--     restored from an older trash snapshot) is marked by the same trigger.
--     Nothing else made 'manual' costs after 2026-09-24; anything older or
--     unclear stays unmarked, so it is entered by hand, never sent.
--   * quickbooks_sync keeps a row for each expense and its receipt, the same
--     way it does for bills, and lead_id: the customer a job cost was on when
--     last seen, so a cost gone with its deleted customer (left alone in
--     QuickBooks) is told apart from one deleted with Edit (deleted there).
--
-- Columns, a trigger and an index are added and the list of record types
-- grows; nothing is removed. Run in the Supabase SQL editor, after 0227.
-- Safe to run twice.

begin;

alter table public.quickbooks_connections
  add column if not exists send_costs boolean not null default false,
  add column if not exists send_costs_from date,
  add column if not exists costs_checked_at timestamptz,
  add column if not exists costs_claimed_until timestamptz,
  -- The QuickBooks bank account lenders pay into: each fee comes out of it (null = not picked; fees wait).
  add column if not exists lender_payouts_account_id text;

alter table public.job_expenses
  add column if not exists lender_fee boolean not null default false;

comment on column public.job_expenses.lender_fee is
  'A lender''s fee saved by the Funded step (DECISIONS #169): the only job costs that go to QuickBooks (#199).';

-- The fees saved since Funded started saving them. Category can't be edited in the app, and created_at never changes.
update public.job_expenses
   set lender_fee = true
 where source = 'manual'
   and category = 'Financing fee'
   and created_at >= '2026-10-07 15:50:58+00'
   and lender_fee is not true;

-- Who may set the mark. NOT security definer on purpose: current_user must be
-- the caller -- 'authenticated' (or 'anon') for the API as a signed-in person,
-- 'service_role' for the server, 'postgres' in the SQL editor.
create or replace function public.job_expenses_lender_fee_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if current_user in ('authenticated', 'anon') then
    -- A person's own insert or edit never marks a cost as a lender's fee, nor unmarks one.
    if tg_op = 'INSERT' then
      new.lender_fee := false;
    else
      new.lender_fee := old.lender_fee;
    end if;
  elsif tg_op = 'INSERT'
    and new.source = 'manual'
    and new.category = 'Financing fee'
    and new.created_at >= '2026-10-07 15:50:58+00' then
    -- The server saved a fee without the mark: a build from before this file,
    -- or a contact restored from a trash snapshot taken before it.
    new.lender_fee := true;
  end if;
  return new;
end;
$$;

drop trigger if exists job_expenses_lender_fee_guard on public.job_expenses;
create trigger job_expenses_lender_fee_guard
  before insert or update of lender_fee on public.job_expenses
  for each row execute function public.job_expenses_lender_fee_guard();

-- A trigger's function needs no one's execute right to fire (as 0212's).
revoke all on function public.job_expenses_lender_fee_guard() from public, anon, authenticated;

-- What the job reads each run: a company's 'manual' costs from its start date.
create index if not exists job_expenses_manual_day_idx
  on public.job_expenses (company_id, spent_on) where source = 'manual';

alter table public.quickbooks_sync
  add column if not exists lead_id uuid;

comment on column public.quickbooks_sync.lead_id is
  'For a job cost''s expense or receipt: the CRM customer it was on when last seen. Not a foreign key, on purpose.';

alter table public.quickbooks_sync drop constraint if exists quickbooks_sync_record_type_check;
alter table public.quickbooks_sync
  add constraint quickbooks_sync_record_type_check check (record_type in (
    'bill', 'bill_payment', 'receipt',
    'customer', 'job', 'invoice', 'deposit', 'customer_payment', 'credit', 'credit_link', 'refund',
    'expense', 'expense_receipt'
  ));

comment on table public.quickbooks_sync is
  'What the CRM sent to each company''s QuickBooks, record by record: bills, bill payments and receipts (DECISIONS #173, #174), customers, jobs, invoices, payments, credits and refunds (#184), and lender fees as expenses with their receipts (#199). Server writes only.';

-- No new table. Re-stamped by house rule (idempotent): every company table carries the subscription lock (0175).
select public.apply_billing_lock_policies();

commit;

-- Check: should read true.
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'quickbooks_connections'
      and column_name in ('send_costs', 'send_costs_from', 'costs_checked_at', 'costs_claimed_until',
                          'lender_payouts_account_id')) = 5
  and exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'job_expenses' and column_name = 'lender_fee')
  and exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'quickbooks_sync' and column_name = 'lead_id')
  and exists (select 1 from pg_trigger
    where tgrelid = 'public.job_expenses'::regclass and tgname = 'job_expenses_lender_fee_guard' and not tgisinternal)
  and exists (
    select 1 from pg_constraint
    where conrelid = 'public.quickbooks_sync'::regclass
      and conname = 'quickbooks_sync_record_type_check'
      and pg_get_constraintdef(oid) like '%expense_receipt%'
  ) as quickbooks_job_costs_ready;

-- For a look (not a check): the 'manual' job costs, marked and not.
select count(*) filter (where lender_fee) as lender_fees,
       count(*) filter (where not lender_fee) as other_already_paid_costs
  from public.job_expenses
 where source = 'manual';
