-- A Bookkeeping role, and cost entry as its own permission.
--
-- Before this the only way to let somebody record what a job cost was to
-- grant Create Estimates -- which also lets them create and edit
-- estimates and contracts. A person hired to file receipts was one click
-- from editing a signed legal document.
--
-- Worth knowing while reading this: the Office role grants estimate
-- access through can_view_estimates_in_company regardless of the
-- per-person checkboxes. Two members here have can_create_estimates =
-- false and hold it anyway. So "just give the bookkeeper Office" would
-- have handed over full contract editing.
--
-- Run each step on its own. No begin/commit.

-- ---------------------------------------------------------------- step 1
-- ON ITS OWN. Postgres will not let a new enum value be *used* in the
-- same transaction that adds it -- run this with nothing else in the
-- editor or step 2 fails with "unsafe use of new value of enum type".
alter type app_role add value if not exists 'Bookkeeping';

-- ---------------------------------------------------------------- step 2
-- Recording a cost, as a capability in its own right rather than a lean
-- on estimate-create.
create or replace function can_manage_costs_in_company(check_company_id uuid)
returns boolean as $$
  select exists (
    select 1 from public.company_members m
    where m.profile_id = auth.uid()
      and m.company_id = check_company_id
      and m.status = 'Active'
      and m.roles && array['Bookkeeping', 'Office', 'Admin']::app_role[]
  );
$$ language sql stable security definer set search_path = public;

-- ---------------------------------------------------------------- step 3
-- Bookkeeping can open a contract, because a cost is filed against a
-- phase and the phases live there. Reading one is the job; editing one
-- is not, and can_create_estimates_in_company deliberately does not
-- follow.
create or replace function can_view_estimates_in_company(check_company_id uuid)
returns boolean as $$
  select exists (
    select 1 from public.company_members m
    where m.profile_id = auth.uid()
      and m.company_id = check_company_id
      and m.status = 'Active'
      and (
        m.can_view_estimates
        or m.roles && array['Office', 'Admin', 'Bookkeeping']::app_role[]
      )
  );
$$ language sql stable security definer set search_path = public;

-- ---------------------------------------------------------------- step 4
drop policy if exists "job_expenses_write" on job_expenses;
create policy "job_expenses_write" on job_expenses for all
  to authenticated
  using (
    is_member_of_company(company_id)
    and can_manage_costs_in_company(company_id)
  )
  with check (
    is_member_of_company(company_id)
    and can_manage_costs_in_company(company_id)
  );

-- ---------------------------------------------------------------- step 5
-- Proof rather than a success message.
select
  (select count(*) from pg_type t join pg_enum e on e.enumtypid = t.oid
    where t.typname = 'app_role' and e.enumlabel = 'Bookkeeping') as role_added,
  (select count(*) from pg_proc where proname = 'can_manage_costs_in_company') as fn_created,
  (select qual from pg_policies
    where tablename = 'job_expenses' and policyname = 'job_expenses_write') as write_rule;
