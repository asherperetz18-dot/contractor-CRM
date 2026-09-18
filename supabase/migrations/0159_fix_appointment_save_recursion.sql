-- Saving any appointment fails for everyone:
--   infinite recursion detected in policy for relation "events"
--
-- What happened: 0152 gave the appointment seats the lead by writing a
-- subquery on public.events straight into the leads_select policy. A
-- subquery inside a policy expression runs under the referenced table's
-- own RLS -- and events has carried the mirror image since 0090: its
-- events_update_dispatch policy reads public.leads inline. So the first
-- appointment UPDATE after 0152 ran (moving a visit, changing its time,
-- confirming it) asked Postgres to expand events' policies -> which
-- opened leads -> whose leads_select opened events again -> refused as
-- infinite recursion, before any row was touched, for every role.
-- Booking and deleting still worked -- only the insert/delete policies
-- are function-only -- which is why the calendar looked fine until
-- someone dragged an appointment.
--
-- The fix breaks the cycle on the side 0152 changed: the events clause
-- moves out of the policy text into a security definer function, the
-- exact shape current_setter_lead_ids (0108) already has one line up.
-- Security definer is what matters -- the rewriter treats the function
-- as opaque, so expanding leads_select no longer opens events at all.
-- The grant itself is unchanged: same two chairs, same rows. The
-- events-side inline read (events_update_dispatch) is left alone on
-- purpose: 0148 learned those policies carry hand edits made in the
-- live database, and one broken edge is all a cycle needs.
--
-- Safe to run twice: create-or-replace + alter to the same text.

create or replace function public.current_appointment_lead_ids()
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select e.lead_id
  from public.events e
  where e.lead_id is not null
    and (e.assigned_to = (select auth.uid())
      or e.second_assigned_to = (select auth.uid()))
$$;

-- 0152's leads_select, with the inline events subquery swapped for the
-- helper. Everything else restated verbatim.
alter policy "leads_select" on public.leads
  using (
    company_id in (select public.current_member_company_ids())
    and (
      company_id not in (select public.current_lead_scoped_company_ids())
      or assigned_to = (select auth.uid())
      or dispatcher_id = (select auth.uid())
      or closer_id = (select auth.uid())
      or (
        company_id in (select public.current_dispatch_scoped_company_ids())
        and dispatcher_id is null
      )
      or id in (select public.current_setter_lead_ids())
      or id in (select public.current_appointment_lead_ids())
    )
  );

-- ── Proof rather than a success message ─────────────────────────────

-- The helper exists and bypasses events RLS (prosecdef = true).
select proname, prosecdef as security_definer
from pg_proc
where proname = 'current_appointment_lead_ids';

-- leads_select goes through it and no longer names events directly:
-- via_helper true, inline_events false.
select
  polname,
  pg_get_expr(polqual, polrelid) like '%current_appointment_lead_ids%' as via_helper,
  pg_get_expr(polqual, polrelid) ilike '%from events%'
    or pg_get_expr(polqual, polrelid) ilike '%from public.events%' as inline_events
from pg_policy
where polname = 'leads_select';

-- Optional second paste, on its own, to watch the failure be gone: the
-- exact rewrite that used to die, as the authenticated role, touching
-- no rows ("UPDATE 0" is the pass). Before this file, the update line
-- alone errored with the recursion message.
--
--   begin;
--   set local role authenticated;
--   update public.events set id = id where false;
--   rollback;
