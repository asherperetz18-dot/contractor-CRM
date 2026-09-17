-- Commission payouts and advances: the money actually handed to a rep.
--
-- The commission report (0086, 0153) computes what each rep has earned
-- and what has become payable, live from the contracts -- but nothing
-- recorded what had actually been PAID. A qualified commission showed
-- as "payable" forever, even after the cheque was written, and an
-- advance given before a job settled had no home at all, so the
-- statement would ask for the full share again at settlement.
--
-- This ledger is that record: one row per payment to a rep, with the
-- amount, the day it moved, an optional job it was against, and whether
-- it was a regular payout or an advance (money given while the job's
-- holds were still on, deducted from the balance due like any payment).
-- Due is then computed per rep: payable less paid, never netted across
-- reps.
--
-- rep_id deliberately has no cascade: a pay record must survive
-- everything, and blocking a profile deletion that still has money
-- against it is the point. estimate_id sets null instead -- if the job
-- goes, the payment becomes a general one to that rep.
--
-- Rows are insert-and-delete only (no update policy): a mis-keyed
-- entry is removed and re-recorded, the same discipline as manual
-- customer payments. recorded_by is what makes hand-entry safe to
-- allow.
--
-- Idempotent; safe as one paste and safe to run twice.

begin;

create table if not exists rep_commission_payouts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  rep_id uuid not null references profiles (id),
  estimate_id uuid references estimates (id) on delete set null,
  amount_cents int not null check (amount_cents > 0),
  kind text not null default 'payout' check (kind in ('payout', 'advance')),
  paid_on date not null default current_date,
  note text,
  recorded_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.rep_commission_payouts is
  'Money actually paid to sales reps against commission: payouts and advances, one row each. Balance due = payable commission less these rows, per rep.';

create index if not exists rep_commission_payouts_rep_idx
  on rep_commission_payouts (company_id, rep_id, paid_on desc);

alter table rep_commission_payouts enable row level security;

-- A rep reads their own pay; Office/Admin read the company's. The same
-- boundary the commission report enforces in its action.
drop policy if exists "rep_commission_payouts_select" on rep_commission_payouts;
create policy "rep_commission_payouts_select" on rep_commission_payouts for select
  to authenticated
  using (
    rep_id = auth.uid()
    or exists (
      select 1 from public.company_members m
      where m.profile_id = auth.uid()
        and m.company_id = rep_commission_payouts.company_id
        and m.status = 'Active'
        and m.roles && array['Office', 'Admin']::app_role[]
    )
  );

-- Recording pay is Office/Admin, and the row must name its author --
-- a payment claiming to be somebody else's entry is refused at the
-- boundary, not by convention.
drop policy if exists "rep_commission_payouts_insert" on rep_commission_payouts;
create policy "rep_commission_payouts_insert" on rep_commission_payouts for insert
  to authenticated
  with check (
    recorded_by = auth.uid()
    and exists (
      select 1 from public.company_members m
      where m.profile_id = auth.uid()
        and m.company_id = rep_commission_payouts.company_id
        and m.status = 'Active'
        and m.roles && array['Office', 'Admin']::app_role[]
    )
  );

-- Undoing a mis-keyed entry, same people. No update policy for anyone:
-- an amount is never edited in place, it is removed and re-recorded.
drop policy if exists "rep_commission_payouts_delete" on rep_commission_payouts;
create policy "rep_commission_payouts_delete" on rep_commission_payouts for delete
  to authenticated
  using (
    exists (
      select 1 from public.company_members m
      where m.profile_id = auth.uid()
        and m.company_id = rep_commission_payouts.company_id
        and m.status = 'Active'
        and m.roles && array['Office', 'Admin']::app_role[]
    )
  );

commit;

-- Verify: the table exists with RLS on, and exactly three policies
-- (select, insert, delete) -- no update.
select relrowsecurity as rls_enabled
from pg_class
where relname = 'rep_commission_payouts';

select polname, polcmd
from pg_policy
where polrelid = 'public.rep_commission_payouts'::regclass
order by polname;
