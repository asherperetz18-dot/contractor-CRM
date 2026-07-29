-- events_write and lead_tasks_write were both "for all" policies with a
-- role-only check (no row restriction). Postgres OR's together every
-- permissive policy for the same command, and "for all" implicitly
-- covers select -- so these were silently bypassing the sales-only
-- per-row restriction added in 0030 for any Sales-role user (confirmed
-- by test: a Sales-only user could still see another rep's calendar
-- event through this policy alone).
drop policy "events_write" on events;
create policy "events_write" on events for all
  to authenticated using (
    has_role('Office') or has_role('Field')
    or (has_role('Sales') and (not is_sales_only() or assigned_to = auth.uid()))
  )
  with check (
    has_role('Office') or has_role('Field')
    or (has_role('Sales') and (not is_sales_only() or assigned_to = auth.uid()))
  );

drop policy "lead_tasks_write" on lead_tasks;
create policy "lead_tasks_write" on lead_tasks for all
  to authenticated using (
    has_role('Office')
    or (has_role('Sales') and (
      not is_sales_only()
      or lead_visible_to_current_user(lead_id)
      or assigned_to = auth.uid()
    ))
  )
  with check (
    has_role('Office')
    or (has_role('Sales') and (
      not is_sales_only()
      or lead_visible_to_current_user(lead_id)
      or assigned_to = auth.uid()
    ))
  );
