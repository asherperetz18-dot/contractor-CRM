-- Closing a company (DECISIONS #135).
--
-- A platform admin can close a company -- a customer who left, a test
-- account, a sign-up that was never real -- and reopen it later. A closed
-- company is locked exactly like a lapsed subscription: its people see a
-- "closed" screen, row-level security hides its data, and its texts,
-- calls, AI and scheduled jobs stop. Nothing is deleted.
--
-- company_closures holds the closed ones. Only the server reads or writes
-- it (row-level security on, no policies), for a platform admin.
--
-- Also: only the server can remove a company row now. No screen ever did;
-- the database no longer allows anyone signed in to.
--
-- Safe to run twice.

begin;

create table if not exists public.company_closures (
  company_id uuid primary key references public.companies (id) on delete cascade,
  closed_at timestamptz not null default now(),
  -- Who closed it; no foreign key, so removing the person keeps the record.
  closed_by uuid,
  reason text
);

alter table public.company_closures enable row level security;

-- The locked companies, as seen by the caller: a lapsed subscription
-- (0175) or a closed company. Empty for platform admins, so they can
-- still look in. The status list must match LOCKED_STATUSES in
-- src/lib/billing/subscription.ts.
create or replace function public.billing_locked_company_ids()
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select locked.company_id
  from (
    select cb.company_id
    from public.company_billing cb
    where cb.billing_status in ('canceled', 'unpaid', 'incomplete_expired', 'paused')
    union
    select cc.company_id
    from public.company_closures cc
  ) locked
  where not exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_platform_admin
  )
$$;

drop policy if exists companies_delete on public.companies;

-- Every company table carries the subscription lock (0175).
select public.apply_billing_lock_policies();

commit;

-- Check: should read true.
select exists (
  select 1 from information_schema.tables
  where table_schema = 'public' and table_name = 'company_closures'
) as company_closures_ready;
