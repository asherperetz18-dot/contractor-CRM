begin;

-- A dispatcher could edit any appointment in the company, including
-- appointments on another dispatcher's leads.
--
-- 0084 granted Dispatch the update it needed to confirm and move visits,
-- but granted it on the whole table:
--
--   using (has_role_in_company('Dispatch', company_id))
--
-- No lead scoping at all. Meanwhile the appointment window has been
-- telling dispatchers the opposite -- "This lead is held by <name>, so
-- this appointment is read-only for you" -- while the database happily
-- accepted the write. Measured on the live database: a second dispatcher
-- rewrote the notes on a colleague's appointment and set its status to
-- Cancelled, one row updated, no error.
--
-- Cancelling is the damage that matters. An appointment is the evidence
-- a trip was made -- the show rate, the follow-up cron and a rep's
-- commission all read it -- so one dispatcher could quietly cancel work
-- another is paid on.
--
-- The rule below is the one the UI already claims and already computes
-- (getEventOwners: isMine = !holder || holder === me): an appointment is
-- workable when its lead is unclaimed or held by you. Appointments with
-- no lead at all stay open, since there is no holder to defer to.
--
-- Only this policy changes. events_write still covers Office, Field and
-- Sales, and permissive policies OR together, so a dispatcher who also
-- holds Office keeps full access -- which is what canAssignAnyone in the
-- UI already assumes.

drop policy if exists "events_update_dispatch" on events;

create policy "events_update_dispatch" on events for update
  to authenticated
  using (
    has_role_in_company('Dispatch'::app_role, company_id)
    and (
      lead_id is null
      or exists (
        select 1 from public.leads
        where leads.id = events.lead_id
          and (leads.dispatcher_id is null or leads.dispatcher_id = auth.uid())
      )
    )
  )
  with check (
    has_role_in_company('Dispatch'::app_role, company_id)
    and (
      lead_id is null
      or exists (
        select 1 from public.leads
        where leads.id = events.lead_id
          and (leads.dispatcher_id is null or leads.dispatcher_id = auth.uid())
      )
    )
  );

-- Proof rather than a success message.
select policyname, cmd, qual
from pg_policies
where schemaname = 'public' and tablename = 'events'
order by policyname;

commit;
