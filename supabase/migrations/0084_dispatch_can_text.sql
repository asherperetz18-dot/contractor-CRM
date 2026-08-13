-- Dispatch can text a customer and book the appointment.
--
-- A dispatcher pressing Send Text got "new row violates row-level
-- security policy for table sms_messages". The app gates SMS on
-- canEditDispatch, which includes Dispatch, so the compose box and the
-- Send button were both there; the database allowed Office or Sales
-- only. Two layers disagreeing, with the customer-facing half of the job
-- on the wrong side of it.
--
-- It surfaced today because josh.c's roles became ["Call Center",
-- "Dispatch"]. He had Office this morning, which was masking it.
--
-- The same gap covered events: Office, Field or Sales could write
-- appointments, not Dispatch. Booking and confirming them is the whole
-- job -- and the system already texts "reply YES to confirm" on the
-- dispatcher's behalf automatically, so the robot half worked and the
-- human half failed.
--
-- Written as separate additive policies rather than altering the
-- existing ones. Permissive policies are OR'd together, so these can
-- only widen. This database has already drifted from these migration
-- files once -- events_write had been split by hand into events_insert,
-- events_update, events_select and events_delete, which is not recorded
-- anywhere here -- so an `alter policy` restating the whole expression
-- risked deleting a condition nobody could see. A permission hole
-- introduced while fixing a permission bug is the worst possible trade.
--
-- Run each step on its own. No begin/commit.

-- ---------------------------------------------------------------- step 1
-- Call Center too: contacting leads is the entire job description.
drop policy if exists "sms_messages_insert_dispatch" on sms_messages;
create policy "sms_messages_insert_dispatch" on sms_messages for insert
  to authenticated with check (
    direction = 'outbound'
    and (
      has_role_in_company('Dispatch', company_id)
      or has_role_in_company('Call Center', company_id)
    )
  );

-- ---------------------------------------------------------------- step 2
drop policy if exists "events_insert_dispatch" on events;
create policy "events_insert_dispatch" on events for insert
  to authenticated with check (has_role_in_company('Dispatch', company_id));

-- ---------------------------------------------------------------- step 3
-- Update, not delete. Confirming and moving an appointment is the job;
-- removing a customer's appointment outright is a larger grant and can
-- be added if it turns out to be needed.
drop policy if exists "events_update_dispatch" on events;
create policy "events_update_dispatch" on events for update
  to authenticated
  using (has_role_in_company('Dispatch', company_id))
  with check (has_role_in_company('Dispatch', company_id));

-- ---------------------------------------------------------------- step 4
-- Proof rather than a success message.
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public' and policyname like '%_dispatch'
order by tablename, policyname;
