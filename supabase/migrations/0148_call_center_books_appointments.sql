-- Call Center can book the appointment it just set.
--
-- The Power Dialer's flow ends with "Book the Appointment": an outcome
-- whose disposition moves the lead to Appointment Scheduled opens a
-- quick-booking modal, and Book & Next inserts an events row as the
-- signed-in user. Office, Field, Sales and Dispatch may insert events;
-- Call Center may not -- so the telemarketer role built for the dialer
-- can record the outcome and move the stage (0137 gave it leads_update,
-- which covers the has_appt/stage write too), but the booking itself is
-- refused with a row-level security error, leaving "Appointment
-- Scheduled" leads with nothing on the calendar. Exactly the gap 0084
-- closed for Dispatch.
--
-- Additive policy, same reasoning as 0084: permissive policies OR
-- together, so a separate policy can only widen, while restating
-- events_insert risks dropping a condition that was edited by hand in
-- the live database. Insert only -- moving or deleting appointments
-- stays with the roles that already have it.
--
-- Company scope with no per-lead carve-out, matching 0137: any lead a
-- Call Center rep can dial, they can book. Evaluate-once shape per
-- 0108/0117.

drop policy if exists "events_insert_call_center" on public.events;
create policy "events_insert_call_center" on public.events for insert
  to authenticated
  with check (company_id in (select public.current_role_company_ids('Call Center'::app_role)));

-- Proof rather than a success message: events_insert_call_center should
-- appear alongside events_insert and events_insert_dispatch.
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public' and tablename = 'events' and cmd = 'INSERT'
order by policyname;
