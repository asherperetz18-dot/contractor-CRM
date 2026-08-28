begin;

-- ====================================================================
-- Row security that costs one evaluation per QUERY, not one per ROW.
--
-- Every helper below was being called as fn(company_id) -- with a
-- column as its argument. A column argument forces the planner to
-- re-run the function for each candidate row, and each call is itself
-- a lookup against company_members. On `leads` (2,218 rows, 1.1 MB)
-- that turned a ~7ms index scan into a ~490ms one, and
-- pg_stat_statements had 268,926 calls against company_members to show
-- for it. Three leads/lead_notes statements were 67% of all database
-- time on the project; reps reported "clicking a page takes a couple
-- of seconds", and the pages that felt slowest are the ones that read
-- the whole leads table.
--
-- Measured on production, same 2,217 rows returned either way:
--
--     helpers evaluated per row : 488.6 ms
--     helpers hoisted           :   7.7 ms
--
-- The fix is to expose the same facts as set-returning functions that
-- take no column argument. `company_id in (select
-- current_member_company_ids())` is uncorrelated, so the planner runs
-- it once as an InitPlan and hashes the result; the per-row cost drops
-- to a hash probe. Wrapping auth.uid() as (select auth.uid()) does the
-- same for the JWT lookup, which was also being re-read per row.
--
-- The original scalar helpers are deliberately kept. Policies on other
-- tables still call them and application code may too; they remain
-- correct, they are just off the hot path. This migration rewrites
-- only the four tables pg_stat_statements named.
--
-- Each function is SECURITY DEFINER for the same reason the ones it
-- replaces are: it reads tables that themselves carry policies, and a
-- policy consulting a protected table through the caller's own
-- permissions would recurse. The `is not null` guards exist so the
-- `not in (...)` forms below stay correct even if one of these columns
-- is ever made nullable.
-- ====================================================================

-- Companies where the caller is an active member.
create or replace function public.current_member_company_ids()
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select cm.company_id
  from public.company_members cm
  where cm.profile_id = (select auth.uid())
    and cm.status = 'Active'
    and cm.company_id is not null
$$;

-- Companies where the caller is a dispatcher confined to their own
-- desk: Dispatch, not a supervisor, and holding no wider role.
create or replace function public.current_dispatch_scoped_company_ids()
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select cm.company_id
  from public.company_members cm
  where cm.profile_id = (select auth.uid())
    and cm.status = 'Active'
    and cm.company_id is not null
    and 'Dispatch' = any(cm.roles::text[])
    and not cm.is_dispatch_supervisor
    and not (cm.roles::text[] && array['Office', 'Admin'])
$$;

-- Companies where the caller only sees the leads that are their own:
-- a Sales rep with no wider role, or a scoped dispatcher. Mirrors
-- is_lead_scoped(), which is_sales_only() is an alias for.
create or replace function public.current_lead_scoped_company_ids()
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select cm.company_id
  from public.company_members cm
  where cm.profile_id = (select auth.uid())
    and cm.status = 'Active'
    and cm.company_id is not null
    and 'Sales' = any(cm.roles::text[])
    and not (cm.roles::text[] && array['Office', 'Admin', 'Field', 'Call Center', 'Dispatch'])
  union
  select * from public.current_dispatch_scoped_company_ids()
$$;

-- Companies where the caller runs the dispatch desk.
create or replace function public.current_supervisor_company_ids()
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select cm.company_id
  from public.company_members cm
  where cm.profile_id = (select auth.uid())
    and cm.status = 'Active'
    and cm.company_id is not null
    and cm.is_dispatch_supervisor
    and 'Dispatch' = any(cm.roles::text[])
$$;

-- Companies where the caller holds a given role. Admin counts as every
-- role, exactly as has_role_in_company() has it. The policies pass a
-- literal here, so this stays uncorrelated.
create or replace function public.current_role_company_ids(check_role app_role)
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select cm.company_id
  from public.company_members cm
  where cm.profile_id = (select auth.uid())
    and cm.status = 'Active'
    and cm.company_id is not null
    and (check_role = any(cm.roles) or 'Admin' = any(cm.roles))
$$;

-- Companies where the caller may delete a contact.
create or replace function public.current_lead_delete_company_ids()
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select cm.company_id
  from public.company_members cm
  where cm.profile_id = (select auth.uid())
    and cm.status = 'Active'
    and cm.company_id is not null
    and (
      'Office' = any(cm.roles)
      or 'Admin' = any(cm.roles)
      or ('Sales' = any(cm.roles) and cm.can_delete_leads = true)
    )
$$;

-- The contacts the caller owns: assigned to them, dispatched by them,
-- or set by them. Replaces lead_visible_to_current_user(lead_id), which
-- took the lead id as an argument and so ran per row.
create or replace function public.current_visible_lead_ids()
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select l.id
  from public.leads l
  where l.assigned_to = (select auth.uid())
     or l.dispatcher_id = (select auth.uid())
     or l.id in (
       select sc.lead_id from public.setter_contacts sc
       where sc.setter_id = (select auth.uid())
     )
$$;

-- The contacts the caller is the setter on. Replaces the correlated
-- EXISTS in leads_select. The membership test is kept because the old
-- EXISTS read setter_contacts through its own policy, which requires
-- it; without that this would widen the rule rather than just speed it
-- up.
create or replace function public.current_setter_lead_ids()
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select sc.lead_id
  from public.setter_contacts sc
  where sc.setter_id = (select auth.uid())
    and sc.company_id in (select public.current_member_company_ids())
$$;

-- ====================================================================
-- leads
-- ====================================================================

alter policy "leads_select" on public.leads
  using (
    company_id in (select public.current_member_company_ids())
    and (
      company_id not in (select public.current_lead_scoped_company_ids())
      or assigned_to = (select auth.uid())
      or dispatcher_id = (select auth.uid())
      or (
        company_id in (select public.current_dispatch_scoped_company_ids())
        and dispatcher_id is null
      )
      or id in (select public.current_setter_lead_ids())
    )
  );

alter policy "leads_insert" on public.leads
  with check (
    company_id in (select public.current_role_company_ids('Office'))
    or company_id in (select public.current_role_company_ids('Sales'))
    or company_id in (select public.current_supervisor_company_ids())
  );

alter policy "leads_update" on public.leads
  using (
    company_id in (select public.current_role_company_ids('Office'))
    or (
      company_id in (select public.current_role_company_ids('Sales'))
      and (
        company_id not in (select public.current_lead_scoped_company_ids())
        or id in (select public.current_visible_lead_ids())
      )
    )
    or (
      company_id in (select public.current_role_company_ids('Dispatch'))
      and (dispatcher_id = (select auth.uid()) or dispatcher_id is null)
    )
    or company_id in (select public.current_supervisor_company_ids())
  )
  with check (
    company_id in (select public.current_role_company_ids('Office'))
    or (
      company_id in (select public.current_role_company_ids('Sales'))
      and (
        company_id not in (select public.current_lead_scoped_company_ids())
        or id in (select public.current_visible_lead_ids())
      )
    )
    or (
      company_id in (select public.current_role_company_ids('Dispatch'))
      and (dispatcher_id = (select auth.uid()) or dispatcher_id is null)
    )
    or company_id in (select public.current_supervisor_company_ids())
  );

alter policy "leads_delete" on public.leads
  using (company_id in (select public.current_lead_delete_company_ids()));

-- ====================================================================
-- lead_notes
-- ====================================================================

alter policy "lead_notes_select" on public.lead_notes
  using (
    company_id in (select public.current_member_company_ids())
    and (
      company_id not in (select public.current_lead_scoped_company_ids())
      or lead_id in (select public.current_visible_lead_ids())
    )
  );

alter policy "lead_notes_insert" on public.lead_notes
  with check (
    company_id in (select public.current_role_company_ids('Office'))
    or company_id in (select public.current_role_company_ids('Sales'))
    or company_id in (select public.current_role_company_ids('Field'))
    or company_id in (select public.current_role_company_ids('Dispatch'))
  );

alter policy "lead_notes_delete" on public.lead_notes
  using (
    company_id in (select public.current_role_company_ids('Office'))
    or company_id in (select public.current_role_company_ids('Admin'))
  );

-- ====================================================================
-- lead_tasks
-- ====================================================================

alter policy "lead_tasks_select" on public.lead_tasks
  using (
    company_id in (select public.current_member_company_ids())
    and (
      company_id not in (select public.current_lead_scoped_company_ids())
      or lead_id in (select public.current_visible_lead_ids())
      or company_id in (select public.current_supervisor_company_ids())
    )
  );

alter policy "lead_tasks_insert" on public.lead_tasks
  with check (
    company_id in (select public.current_role_company_ids('Office'))
    or (
      company_id in (select public.current_role_company_ids('Sales'))
      and (
        company_id not in (select public.current_lead_scoped_company_ids())
        or lead_id in (select public.current_visible_lead_ids())
        or assigned_to = (select auth.uid())
      )
    )
    or (
      company_id in (select public.current_role_company_ids('Dispatch'))
      and lead_id in (select public.current_visible_lead_ids())
    )
    or company_id in (select public.current_supervisor_company_ids())
  );

alter policy "lead_tasks_update" on public.lead_tasks
  using (
    company_id in (select public.current_role_company_ids('Office'))
    or (
      company_id in (select public.current_role_company_ids('Sales'))
      and (
        company_id not in (select public.current_lead_scoped_company_ids())
        or lead_id in (select public.current_visible_lead_ids())
        or assigned_to = (select auth.uid())
      )
    )
    or (
      company_id in (select public.current_role_company_ids('Dispatch'))
      and lead_id in (select public.current_visible_lead_ids())
    )
    or company_id in (select public.current_supervisor_company_ids())
  )
  with check (
    company_id in (select public.current_role_company_ids('Office'))
    or (
      company_id in (select public.current_role_company_ids('Sales'))
      and (
        company_id not in (select public.current_lead_scoped_company_ids())
        or lead_id in (select public.current_visible_lead_ids())
        or assigned_to = (select auth.uid())
      )
    )
    or (
      company_id in (select public.current_role_company_ids('Dispatch'))
      and lead_id in (select public.current_visible_lead_ids())
    )
    or company_id in (select public.current_supervisor_company_ids())
  );

alter policy "lead_tasks_delete" on public.lead_tasks
  using (
    company_id in (select public.current_role_company_ids('Office'))
    or company_id in (select public.current_role_company_ids('Admin'))
    or (
      company_id in (select public.current_role_company_ids('Sales'))
      and (
        company_id not in (select public.current_lead_scoped_company_ids())
        or lead_id in (select public.current_visible_lead_ids())
        or assigned_to = (select auth.uid())
      )
    )
  );

-- ====================================================================
-- setter_contacts
-- ====================================================================

alter policy "setter_contacts_select" on public.setter_contacts
  using (
    company_id in (select public.current_member_company_ids())
    and (
      company_id not in (select public.current_lead_scoped_company_ids())
      or setter_id = (select auth.uid())
    )
  );

alter policy "setter_contacts_write" on public.setter_contacts
  using (
    company_id in (select public.current_role_company_ids('Office'))
    or (
      company_id in (select public.current_role_company_ids('Sales'))
      and (
        company_id not in (select public.current_lead_scoped_company_ids())
        or setter_id = (select auth.uid())
      )
    )
  )
  with check (
    company_id in (select public.current_role_company_ids('Office'))
    or (
      company_id in (select public.current_role_company_ids('Sales'))
      and (
        company_id not in (select public.current_lead_scoped_company_ids())
        or setter_id = (select auth.uid())
      )
    )
  );

commit;
