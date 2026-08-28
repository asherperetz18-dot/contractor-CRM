-- Production role: sees every job and its money, records costs and
-- receipts, writes change orders, controls the schedule.
--
-- Written to survive being run as ONE paste in the Supabase SQL editor,
-- which executes the whole script in a single implicit transaction.
-- Postgres allows ADD VALUE inside a transaction but forbids USING the
-- new value before commit -- so nothing below uses it at parse time:
-- function bodies skip validation (check_function_bodies off, the same
-- trick pg_dump relies on) and the policies compare roles as text.
-- Idempotent throughout; safe to run twice.

set check_function_bodies = off;

alter type app_role add value if not exists 'Production';

-- Production sees every job and its money, like Bookkeeping does --
-- the role's whole point is running sold work.
create or replace function can_view_estimates_in_company(check_company_id uuid)
returns boolean as $$
  select exists (
    select 1 from public.company_members m
    where m.profile_id = auth.uid()
      and m.company_id = check_company_id
      and m.status = 'Active'
      and (
        m.can_view_estimates
        or m.roles && array['Office', 'Admin', 'Bookkeeping', 'Production']::app_role[]
      )
  );
$$ language sql stable security definer set search_path = public;

-- And writes documents: change orders are estimate rows, and sending
-- one to the customer is part of running the job.
create or replace function can_create_estimates_in_company(check_company_id uuid)
returns boolean as $$
  select exists (
    select 1 from public.company_members m
    where m.profile_id = auth.uid()
      and m.company_id = check_company_id
      and m.status = 'Active'
      and (
        m.can_create_estimates
        or m.roles && array['Office', 'Admin', 'Production']::app_role[]
      )
  );
$$ language sql stable security definer set search_path = public;

-- Receipts and costs.
create or replace function can_manage_costs_in_company(check_company_id uuid)
returns boolean as $$
  select exists (
    select 1 from public.company_members m
    where m.profile_id = auth.uid()
      and m.company_id = check_company_id
      and m.status = 'Active'
      and m.roles && array['Bookkeeping', 'Office', 'Admin', 'Production']::app_role[]
  );
$$ language sql stable security definer set search_path = public;

-- Full schedule control: book and move any appointment, unscoped, like
-- Office. Delete stays Office/Admin only. The role test is spelled out
-- against roles::text[] rather than has_role_in_company('Production',..)
-- because a policy expression is parsed at CREATE POLICY time, and the
-- enum literal would trip the same-transaction rule this file avoids.
drop policy if exists "events_insert_production" on events;
create policy "events_insert_production" on events for insert
  to authenticated with check (exists (
    select 1 from public.company_members m
    where m.profile_id = auth.uid()
      and m.company_id = events.company_id
      and m.status = 'Active'
      and 'Production' = any(m.roles::text[])
  ));

drop policy if exists "events_update_production" on events;
create policy "events_update_production" on events for update
  to authenticated
  using (exists (
    select 1 from public.company_members m
    where m.profile_id = auth.uid()
      and m.company_id = events.company_id
      and m.status = 'Active'
      and 'Production' = any(m.roles::text[])
  ))
  with check (exists (
    select 1 from public.company_members m
    where m.profile_id = auth.uid()
      and m.company_id = events.company_id
      and m.status = 'Active'
      and 'Production' = any(m.roles::text[])
  ));

-- The receipt behind a cost: a photo snapped at the counter or the
-- supplier's PDF. Kept on the expense row itself -- a receipt is part
-- of the cost, not a customer file.
alter table job_expenses add column if not exists receipt_url text;
alter table job_expenses add column if not exists receipt_path text;
