-- 0217: switching a signed contract to financing (DECISIONS #166).
--
-- A customer who signed to pay directly can pay the rest through the
-- company's lender instead. The office sends a one-page payment change;
-- the customer signs it on their customer page. While it's signed, the
-- contract's unpaid payments read "Financing": no bills or payment
-- reminders go out for them, and the lender's payout settles them (#163).
-- "Back to the original schedule" ends it.
--
--   * contract_payment_changes: one row per payment change. What it said
--     when it was sent (lender, contract total, paid so far, amount to
--     finance), who signed it, when, and from where; and when it ended.
--     sent -> signed -> reverted, or sent -> cancelled. One open (sent or
--     signed) change per contract. The company's people can read it;
--     only the server writes it.
--
-- A table is added, nothing is removed: the running code reads it on its
-- own and offers no switch without it. Run in the Supabase SQL editor.
-- Safe to run twice.

begin;

create table if not exists public.contract_payment_changes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  estimate_id uuid not null references public.estimates (id) on delete cascade,
  status text not null default 'sent' check (status in ('sent', 'signed', 'cancelled', 'reverted')),
  -- What the customer is asked to sign, as it stood when it was sent.
  lender text not null check (length(lender) between 1 and 120),
  total_cents bigint not null check (total_cents >= 0),
  paid_cents bigint not null check (paid_cents >= 0),
  finance_cents bigint not null check (finance_cents > 0 and finance_cents <= 10000000000),
  -- The customer's signature: their typed name, when, and from where.
  signed_name text check (signed_name is null or length(signed_name) between 2 and 120),
  signed_at timestamptz,
  signed_ip text check (signed_ip is null or length(signed_ip) <= 64),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  -- Cancelled before signing, or back to the original schedule.
  ended_at timestamptz,
  ended_by uuid references public.profiles (id) on delete set null,
  check (status <> 'signed' or (signed_name is not null and signed_at is not null))
);

comment on table public.contract_payment_changes is
  'A signed contract switched to financing (DECISIONS #166). While a row is signed, the contract''s unpaid payments are paid through the lender.';

create unique index if not exists contract_payment_changes_one_open
  on public.contract_payment_changes (estimate_id)
  where status in ('sent', 'signed');

create index if not exists contract_payment_changes_company_idx
  on public.contract_payment_changes (company_id, estimate_id, created_at);

alter table public.contract_payment_changes enable row level security;
drop policy if exists contract_payment_changes_select on public.contract_payment_changes;
create policy contract_payment_changes_select on public.contract_payment_changes for select
  to authenticated
  using (company_id in (select public.current_member_company_ids()));

-- Every company table carries the subscription lock (0175).
select public.apply_billing_lock_policies();

commit;

-- Check: should read true.
select
  exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'contract_payment_changes')
  as payment_changes_ready;
