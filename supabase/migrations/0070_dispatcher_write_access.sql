-- A dispatcher works their leads: claims them, notes what happened, sets
-- follow-up tasks. What they must never do is remove anything -- the
-- lead history is what the commission is argued from, and the person
-- being paid on a job should not be able to erase parts of it.
--
-- All three policies below required Office or Sales, so a pure Dispatch
-- user could not claim a lead, write a note, or create a task at all.
--
-- Run each step on its own and check it succeeded before the next.
--
-- No begin/commit: wrapping this in a transaction is why it never landed
-- the first time. One failing statement rolled the whole block back and
-- the editor reported nothing, so three separate "done" confirmations
-- described a database that had not changed.
--
-- alter, not drop-and-recreate, wherever the policy already exists. A
-- drop that succeeds followed by a create that fails leaves the table
-- with no policy at all, which locks every user out of it rather than
-- leaving things as they were.

-- ---------------------------------------------------------------- step 1
-- Claiming is an update on the lead, so without this the Claim button
-- silently matches zero rows. A dispatcher may take an unclaimed lead or
-- work one already theirs; the with-check stops them writing a
-- colleague's id into it, which would be taking their commission.

alter policy "leads_update" on leads
  using (
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

-- ---------------------------------------------------------------- step 2
-- Notes: a dispatcher can add them. Deleting them stays Office/Admin,
-- which is already how the delete policy reads and is left untouched.

alter policy "lead_notes_insert" on lead_notes
  with check (
    has_role_in_company('Office', company_id)
    or has_role_in_company('Sales', company_id)
    or has_role_in_company('Field', company_id)
    or has_role_in_company('Dispatch', company_id)
  );

-- ---------------------------------------------------------------- step 3
-- Tasks were governed by one "for all" policy, which grants delete as
-- well. Adding Dispatch to it would have handed them deletion too, so it
-- is split: write covers insert and update, delete is its own policy and
-- deliberately excludes Dispatch.
--
-- The new policies are created while the old one is still in place.
-- Permissive policies OR together, so the only state in between is a
-- briefly more permissive one -- never a locked table.

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

-- ---------------------------------------------------------------- step 4
-- Only now that the replacements exist. This is the statement that takes
-- delete away from Dispatch.

drop policy if exists "lead_tasks_write" on lead_tasks;

-- ---------------------------------------------------------------- step 5
-- Proof, rather than a "success" message. Expect leads_update,
-- lead_notes_insert, and lead_tasks_insert / _update / _delete, with no
-- lead_tasks_write remaining.

select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('leads', 'lead_notes', 'lead_tasks')
order by tablename, policyname;
