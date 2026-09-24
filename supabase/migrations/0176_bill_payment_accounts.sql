-- Where bill money comes out of, and room for the QuickBooks sync.
--
-- "+ Add bill" now takes one or more payment lines -- a method, an
-- amount, a check/ref number and the account it was paid from (Chase
-- checking, the Amex card, petty cash). QuickBooks Online records a bill
-- the same way: one Bill, one Bill Payment per payment, each out of a
-- bank or credit-card account. So:
--
--   payment_accounts                  the company's "paid from" list
--   vendor_bill_payments.paid_from_account_id
--   vendor_bills.qb_bill_id / qb_synced_at            filled by a future sync,
--   vendor_bill_payments.qb_payment_id / qb_synced_at so nothing is sent twice
--
-- Before this runs the CRM keeps working: the form simply has no "Paid
-- from" choice, and payments save without an account.
--
-- Idempotent; safe as one paste and safe to run twice.

begin;

create table if not exists payment_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  name text not null,
  kind text not null default 'bank' check (kind in ('bank', 'credit_card', 'cash')),
  last4 text,
  -- The matching QuickBooks account, set once QuickBooks is connected.
  qb_account_id text,
  archived_at timestamptz,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.payment_accounts is
  'Bank, credit-card and cash accounts vendor bills are paid from. Maps to QuickBooks bank/credit-card accounts for Bill Payment sync.';

create index if not exists payment_accounts_company_idx on payment_accounts (company_id);

alter table payment_accounts enable row level security;

-- Read by anyone who records costs (Field picks "paid from" at the
-- counter); written by the same roles that run Bills to Pay.
drop policy if exists "payment_accounts_select" on payment_accounts;
create policy "payment_accounts_select" on payment_accounts for select
  to authenticated
  using (
    company_id in (select public.current_member_company_ids())
    and can_manage_costs_in_company(company_id)
  );

drop policy if exists "payment_accounts_write" on payment_accounts;
create policy "payment_accounts_write" on payment_accounts for all
  to authenticated
  using (
    exists (
      select 1 from public.company_members m
      where m.profile_id = auth.uid()
        and m.company_id = payment_accounts.company_id
        and m.status = 'Active'
        and m.roles && array['Office', 'Admin', 'Bookkeeping']::app_role[]
    )
  )
  with check (
    exists (
      select 1 from public.company_members m
      where m.profile_id = auth.uid()
        and m.company_id = payment_accounts.company_id
        and m.status = 'Active'
        and m.roles && array['Office', 'Admin', 'Bookkeeping']::app_role[]
    )
  );

alter table vendor_bill_payments
  add column if not exists paid_from_account_id uuid references payment_accounts (id) on delete set null;
alter table vendor_bill_payments add column if not exists qb_payment_id text;
alter table vendor_bill_payments add column if not exists qb_synced_at timestamptz;

alter table vendor_bills add column if not exists qb_bill_id text;
alter table vendor_bills add column if not exists qb_synced_at timestamptz;

commit;

-- A new tenant table: stamp the subscription lockout onto it (0175), or a
-- lapsed company could still read it through the API.
select public.apply_billing_lock_policies();

-- Proof rather than a success message.
select relrowsecurity as rls_enabled
from pg_class
where relname = 'payment_accounts';

select column_name
from information_schema.columns
where table_name in ('vendor_bill_payments', 'vendor_bills')
  and column_name in ('paid_from_account_id', 'qb_payment_id', 'qb_bill_id', 'qb_synced_at')
order by column_name;
