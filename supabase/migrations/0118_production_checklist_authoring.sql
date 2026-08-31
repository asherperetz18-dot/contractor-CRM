-- Production authors the job checklist -- but never erases it. They
-- run sold work (writing change orders and recording costs already),
-- yet couldn't add "order the stucco sample" to a job's own plan.
-- Adding steps (and via the same insert path, applying a template) now
-- includes Production. DELETE stays Office/Admin: removing a step
-- erases the record that it was ever part of the plan. Check-off and
-- date/owner edits ride the existing any-member update policy with the
-- app enforcing who may shape them; the template LIBRARY in settings
-- stays Office/Admin.
--
-- Idempotent; safe as one paste and safe to run twice.

begin;

drop policy if exists "project_checklist_items_insert" on project_checklist_items;
create policy "project_checklist_items_insert" on project_checklist_items for insert
  to authenticated
  with check (
    has_role_in_company('Office', company_id)
    or has_role_in_company('Admin', company_id)
    or has_role_in_company('Production', company_id)
  );

commit;
