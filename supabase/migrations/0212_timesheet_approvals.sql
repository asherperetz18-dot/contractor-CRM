-- 0212: timesheet week approval (DECISIONS #157).
--
-- Office or Admin signs off a person's week on Timesheets once it is
-- over. From then on nobody can add or change a punch in that week --
-- what goes to payroll is the week that was approved. Reopening it takes
-- a reason and is kept on record.
--
--   * timesheet_approvals: one row per approval. The week is stored as
--     the instants it covers on the company's clock (Monday 00:00 to the
--     next Monday 00:00), worked out by the app, so the lock needs no
--     time zone arithmetic. A reopened approval keeps its row (who, when,
--     why); at most one live approval per person and week.
--   * time_punches_week_lock: refuses an insert or update of a punch that
--     starts, or would start, inside a live approved week -- for everyone,
--     Office and Admin included, and whichever way it is written. Punches
--     are never deleted by people (0174 has no delete policy), so a
--     company or person removed still takes theirs with them.
--
-- A table, two functions and a trigger are added, nothing is removed:
-- the running code ignores them. Run in the Supabase SQL editor. Safe to
-- run twice.

begin;

create table if not exists public.timesheet_approvals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  -- Whose week.
  profile_id uuid not null references public.profiles (id) on delete cascade,
  -- The week's Monday, on the company's calendar.
  week_start date not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  -- The hours as approved, for the record.
  total_minutes integer not null default 0,
  overtime_minutes integer not null default 0,
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz not null default now(),
  reopened_by uuid references public.profiles (id) on delete set null,
  reopened_at timestamptz,
  reopen_reason text,
  check (period_end > period_start),
  check (reopened_at is null or coalesce(trim(reopen_reason), '') <> '')
);

comment on table public.timesheet_approvals is
  'A person''s week approved for payroll (DECISIONS #157). While live (not reopened) its punches can''t change.';

create unique index if not exists timesheet_approvals_live_key
  on public.timesheet_approvals (company_id, profile_id, week_start) where reopened_at is null;
create index if not exists timesheet_approvals_company_idx
  on public.timesheet_approvals (company_id, week_start);

-- Read by the office, and by each person for their own weeks. No write
-- policies: the server approves and reopens, after checking the role.
alter table public.timesheet_approvals enable row level security;
drop policy if exists timesheet_approvals_select on public.timesheet_approvals;
create policy timesheet_approvals_select on public.timesheet_approvals for select
  to authenticated
  using (
    (profile_id = auth.uid() and is_member_of_company(company_id))
    or has_role_in_company('Office', company_id)
    or has_role_in_company('Admin', company_id)
  );

-- Is this moment inside one of this person's approved weeks?
create or replace function public.timesheet_week_locked(p_company uuid, p_profile uuid, p_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.timesheet_approvals a
     where a.company_id = p_company
       and a.profile_id = p_profile
       and a.reopened_at is null
       and p_at >= a.period_start
       and p_at < a.period_end
  );
$$;

create or replace function public.time_punches_week_lock() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Where the punch was, and where it's going.
  if (tg_op = 'UPDATE' and public.timesheet_week_locked(old.company_id, old.profile_id, old.clock_in))
     or public.timesheet_week_locked(new.company_id, new.profile_id, new.clock_in) then
    raise exception 'This week has been approved. Reopen it on Timesheets to change its hours.'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

drop trigger if exists time_punches_week_lock on public.time_punches;
create trigger time_punches_week_lock before insert or update on public.time_punches
  for each row execute function public.time_punches_week_lock();

revoke all on function public.timesheet_week_locked(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.time_punches_week_lock() from public, anon, authenticated;

-- Every company table carries the subscription lock (0175).
select public.apply_billing_lock_policies();

commit;

-- Check: should read true.
select
  exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'timesheet_approvals')
  and exists (select 1 from pg_trigger where tgname = 'time_punches_week_lock' and not tgisinternal)
  as timesheet_approvals_ready;
