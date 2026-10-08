-- 0222: QuickBooks, step 2 -- bills and bill payments go to QuickBooks
-- (DECISIONS #173).
--
-- Once a company turns it on (Settings › QuickBooks), every bill dated
-- from its start date goes to its QuickBooks Online as a Bill, and every
-- payment on it as a Bill Payment from the account it was paid from, a
-- few minutes after it's saved. A change in the CRM is sent too; a bill
-- voided in the CRM is deleted in QuickBooks, a payment deleted in the CRM
-- is voided there. Only what the CRM sent is ever changed.
--
--   * quickbooks_connections: the switch, the start date, when the job
--     last looked, and a short claim so two runs never send the same
--     company's bills at once.
--   * quickbooks_sync: one row per bill or payment, per QuickBooks
--     company: QuickBooks' id for it, what was sent, and -- when it hasn't
--     gone -- why. record_id is deliberately not a foreign key: a payment
--     deleted in the CRM leaves its row behind, so the job still knows to
--     void it in QuickBooks. Before adding a bill or payment the job writes
--     the exact request, with its request id, into `doubt`; if no answer
--     came, the next run repeats it (QuickBooks answers a repeat of a
--     request id without adding it twice).
--     The cost-money roles can read it (Bills to Pay shows it); only the
--     server writes it.
--   * The job runs every five minutes, from the database's scheduler
--     (0203), like the other scheduled jobs.
--
-- Columns and a table are added, nothing is removed. Run in the Supabase
-- SQL editor. Safe to run twice.

begin;

alter table public.quickbooks_connections
  add column if not exists send_bills boolean not null default false,
  add column if not exists send_bills_from date,
  add column if not exists bills_checked_at timestamptz,
  add column if not exists bills_claimed_until timestamptz;

create table if not exists public.quickbooks_sync (
  company_id uuid not null references public.companies (id) on delete cascade,
  -- The QuickBooks company it went to: connecting another one starts fresh.
  realm_id text not null,
  record_type text not null check (record_type in ('bill', 'bill_payment')),
  -- vendor_bills.id or vendor_bill_payments.id. Not a foreign key, on purpose.
  record_id uuid not null,
  -- The bill a payment belongs to (the bill itself, for a bill).
  bill_id uuid,
  -- QuickBooks' Id, once it's there.
  qb_id text,
  -- What QuickBooks has: a hash of the version that last went.
  qb_hash text,
  -- The last version that didn't go (waiting or refused), to tell when it changes.
  tried_hash text,
  -- An add sent with no answer back: { requestId, body, hash }, repeated next run.
  doubt jsonb,
  -- sent, waiting, failed (refused), removed (voided or deleted after the
  -- CRM voided or deleted it), gone (deleted in QuickBooks by someone there).
  status text not null default 'waiting' check (status in ('sent', 'waiting', 'failed', 'removed', 'gone')),
  -- While failed: which step QuickBooks refused -- adding it, a change, or removing it.
  failed_op text check (failed_op in ('add', 'change', 'remove')),
  reason text,
  tries integer not null default 0,
  next_try_at timestamptz,
  sent_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (company_id, realm_id, record_type, record_id)
);

create index if not exists quickbooks_sync_status_idx on public.quickbooks_sync (company_id, realm_id, status);

comment on table public.quickbooks_sync is
  'What the CRM sent to each company''s QuickBooks, bill by bill and payment by payment (DECISIONS #173). Server writes only.';

alter table public.quickbooks_sync enable row level security;
drop policy if exists quickbooks_sync_select on public.quickbooks_sync;
create policy quickbooks_sync_select on public.quickbooks_sync for select
  to authenticated
  using (is_member_of_company(company_id) and can_manage_costs_in_company(company_id));
revoke insert, update, delete on public.quickbooks_sync from anon, authenticated;

-- Every company table carries the subscription lock (0175).
select public.apply_billing_lock_policies();

-- Every five minutes. Where the scheduler (0203) isn't set up, this is
-- skipped and the rest still applies.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron')
     and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'crm_jobs' and p.proname = 'run') then
    perform cron.schedule('crm-quickbooks-sync', '*/5 * * * *', $job$select crm_jobs.run('/api/cron/quickbooks-sync')$job$);
  end if;
end
$$;

commit;

-- Check: should read true.
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'quickbooks_connections'
      and column_name in ('send_bills', 'send_bills_from', 'bills_checked_at', 'bills_claimed_until')) = 4
  and exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'quickbooks_sync')
  as quickbooks_bills_ready;

-- And the job is on the schedule: should read 1.
select count(*) as quickbooks_sync_job from cron.job where jobname = 'crm-quickbooks-sync' and active;
