-- Let anyone who can edit leads (Office/Admin/Sales) add a brand-new
-- Project Type or Source option inline while editing a lead, without
-- needing to go to Settings. Renaming/deleting/reordering the shared
-- list stays restricted to Office/Admin.
drop policy "project_types_write" on project_types;
drop policy "lead_sources_write" on lead_sources;

create policy "project_types_insert" on project_types for insert
  to authenticated with check (has_role('Office') or has_role('Admin') or has_role('Sales'));
create policy "project_types_update" on project_types for update
  to authenticated using (has_role('Office') or has_role('Admin'))
  with check (has_role('Office') or has_role('Admin'));
create policy "project_types_delete" on project_types for delete
  to authenticated using (has_role('Office') or has_role('Admin'));

create policy "lead_sources_insert" on lead_sources for insert
  to authenticated with check (has_role('Office') or has_role('Admin') or has_role('Sales'));
create policy "lead_sources_update" on lead_sources for update
  to authenticated using (has_role('Office') or has_role('Admin'))
  with check (has_role('Office') or has_role('Admin'));
create policy "lead_sources_delete" on lead_sources for delete
  to authenticated using (has_role('Office') or has_role('Admin'));
