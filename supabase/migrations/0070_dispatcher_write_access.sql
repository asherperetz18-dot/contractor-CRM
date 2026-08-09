begin;

-- A dispatcher works their leads: claims them, notes what happened, sets
-- follow-up tasks. What they must never do is remove anything -- the
-- lead history is what the commission is argued from, and the person
-- being paid on a job should not be able to erase parts of it.
--
-- All three policies below required Office or Sales, so a pure Dispatch
-- user could not claim a lead, write a note, or create a task at all.

-- Claiming is an update on the lead, so without this the Claim button
-- silently matches zero rows. A dispatcher may take an unclaimed lead or
-- work one already theirs; the with-check stops them writing a
-- colleague's id into it, which would be taking their commission.
drop policy if exists "leads_update" on leads;
create policy "leads_update" on leads for update
  to authenticated using (
    has_role_in_company('Office', company_id)
    or (has_role_in_company('Sales', company_id) and (not is_sales_only(company_id) or lead_visible_to_current_user(id)))
    or (
      has_role_in_company('Dispatch', company_id)
      and (dispatcher_id = auth.uid() or dispatcher_id is null)
    )
  )
  with check (
    has_role_in_company('Office', company_id)
    or (has_role_in_company('Sales', company_id) and (not is_sales_only(company_id) or lead_visible_to_current_user(id)))
    or (
      has_role_in_company('Dispatch', company_id)
      and (dispatcher_id = auth.uid() or dispatcher_id is null)
    )
  );

-- Notes: a dispatcher can add them. Deleting them stays Office/Admin,
-- which is already how the delete policy reads and is left untouched.
drop policy if exists "lead_notes_insert" on lead_notes;
create policy "lead_notes_insert" on lead_notes for insert
  to authenticated with check (
    has_role_in_company('Office', company_id)
    or has_role_in_company('Sales', company_id)
    or has_role_in_company('Field', company_id)
    or has_role_in_company('Dispatch', company_id)
  );

-- Tasks were governed by one "for all" policy, which grants delete as
-- well. Adding Dispatch to it would have handed them deletion too, so it
-- is split: write covers insert and update, delete is its own policy and
-- deliberately excludes Dispatch.
drop policy if exists "lead_tasks_write" on lead_tasks;

create policy "lead_tasks_insert" on lead_tasks for insert
  to authenticated with check (
    has_role_in_company('Office', company_id)
    or (has_role_in_company('Sales', company_id) and (
      not is_sales_only(company_id)
      or lead_visible_to_current_user(lead_id)
      or assigned_to = auth.uid()
    ))
    or (has_role_in_company('Dispatch', company_id) and lead_visible_to_current_user(lead_id))
  );

create policy "lead_tasks_update" on lead_tasks for update
  to authenticated using (
    has_role_in_company('Office', company_id)
    or (has_role_in_company('Sales', company_id) and (
      not is_sales_only(company_id)
      or lead_visible_to_current_user(lead_id)
      or assigned_to = auth.uid()
    ))
    or (has_role_in_company('Dispatch', company_id) and lead_visible_to_current_user(lead_id))
  )
  with check (
    has_role_in_company('Office', company_id)
    or (has_role_in_company('Sales', company_id) and (
      not is_sales_only(company_id)
      or lead_visible_to_current_user(lead_id)
      or assigned_to = auth.uid()
    ))
    or (has_role_in_company('Dispatch', company_id) and lead_visible_to_current_user(lead_id))
  );

-- Unchanged for Office and Sales; Dispatch is absent on purpose.
create policy "lead_tasks_delete" on lead_tasks for delete
  to authenticated using (
    has_role_in_company('Office', company_id)
    or has_role_in_company('Admin', company_id)
    or (has_role_in_company('Sales', company_id) and (
      not is_sales_only(company_id)
      or lead_visible_to_current_user(lead_id)
      or assigned_to = auth.uid()
    ))
  );

commit;
