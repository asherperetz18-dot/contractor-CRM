-- Job costs, per phase.
--
-- What a job actually cost, as opposed to what it was quoted at. The
-- estimate already carries a cost per line item, but that is the number
-- somebody guessed while quoting -- 1 of 112 line items here has one
-- entered at all, which is a fair measure of how much anyone trusts it.
-- This table holds money actually spent.
--
-- Anchored to the lead rather than to a job row: `jobs` is empty and
-- unused, while every contract, change order and payment phase already
-- hangs off the lead. One customer at one address is the job.
--
-- The phase is nullable on purpose. QuickBooks Projects have no phases,
-- so an imported expense arrives knowing its job and nothing more. It
-- lands unassigned and someone files it -- which is only honest, since
-- the alternative is guessing a phase and printing a margin built on the
-- guess.
--
-- Run each step on its own. No begin/commit.

-- ---------------------------------------------------------------- step 1
create table if not exists job_expenses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,

  -- The payment phase this cost belongs to. Null means "on the job, not
  -- yet filed against a phase" -- a real state, not a missing value.
  estimate_payment_id uuid references estimate_payments(id) on delete set null,

  vendor text,
  -- The expense account in QuickBooks ("Job Materials", "Subcontractors")
  -- or whatever was typed by hand. Kept as text: mirroring QuickBooks'
  -- chart of accounts into here would be a second copy to keep in step.
  category text,
  description text,

  -- Signed. A vendor credit or a returned pallet is a negative cost, and
  -- forcing it positive would overstate what the job spent.
  amount_cents bigint not null,
  spent_on date not null,

  -- 'manual' or 'quickbooks'. Which rows a sync may overwrite and which
  -- it must leave alone.
  source text not null default 'manual',

  -- QuickBooks provenance. A single Purchase can spread lines across
  -- several projects, so the line number is part of the identity.
  qb_txn_id text,
  qb_txn_type text,
  qb_line_num int,
  qb_project_id text,
  synced_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);

-- ---------------------------------------------------------------- step 2
-- What makes a re-sync safe. Without this, every run would add another
-- copy of the same receipt and the job would look progressively less
-- profitable for no reason at all.
create unique index if not exists job_expenses_qb_line
  on job_expenses (company_id, qb_txn_type, qb_txn_id, qb_line_num)
  where qb_txn_id is not null;

create index if not exists job_expenses_lead_idx
  on job_expenses (company_id, lead_id, spent_on desc);

create index if not exists job_expenses_phase_idx
  on job_expenses (estimate_payment_id) where estimate_payment_id is not null;

-- ---------------------------------------------------------------- step 3
alter table job_expenses enable row level security;

-- Read gated exactly like estimates. A cost is a margin: anyone who can
-- see what a job cost and what it sold for knows the markup, so this
-- cannot be looser than the document the markup comes from. Sales-only
-- members stay confined to leads they can already see.
drop policy if exists "job_expenses_select" on job_expenses;
create policy "job_expenses_select" on job_expenses for select
  to authenticated using (
    is_member_of_company(company_id)
    and can_view_estimates_in_company(company_id)
    and (not is_sales_only(company_id) or lead_visible_to_current_user(lead_id))
  );

-- Writing a cost is the same permission as writing an estimate -- both
-- move the money on a job. with_check as well as using, so a row cannot
-- be edited into another company on its way out.
drop policy if exists "job_expenses_write" on job_expenses;
create policy "job_expenses_write" on job_expenses for all
  to authenticated
  using (
    is_member_of_company(company_id)
    and can_create_estimates_in_company(company_id)
  )
  with check (
    is_member_of_company(company_id)
    and can_create_estimates_in_company(company_id)
  );

-- ---------------------------------------------------------------- step 4
-- Proof rather than a success message.
select
  (select count(*) from information_schema.tables
    where table_name = 'job_expenses') as table_created,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'job_expenses') as policies,
  (select count(*) from pg_indexes
    where tablename = 'job_expenses') as indexes;
