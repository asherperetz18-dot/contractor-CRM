-- Fix the same permissive-"for all"-policy leak as 0031, just on a table
-- that pass missed: setter_contacts_write (Office or Sales, no row
-- check) was implicitly granting unrestricted select AND write over
-- every rep's setter assignments to any Sales-role user, bypassing
-- setter_contacts_select's row scoping from 0030.
drop policy "setter_contacts_write" on setter_contacts;
create policy "setter_contacts_write" on setter_contacts for all
  to authenticated using (
    has_role('Office')
    or (has_role('Sales') and (not is_sales_only() or setter_id = auth.uid()))
  )
  with check (
    has_role('Office')
    or (has_role('Sales') and (not is_sales_only() or setter_id = auth.uid()))
  );

-- Hide the Dispatch/manager-level pages from the Sales role's nav (and
-- block direct URL access -- the app layout gates on this same table).
-- Uses the existing Role Visibility system (Settings -> Role Visibility)
-- so it's reversible from the UI without a code change. Reply Inbox and
-- Call Reports are intentionally left visible for now -- their
-- underlying data (sms_messages, call_logs) isn't scoped by lead
-- ownership yet, so hiding vs. properly scoping them is a separate,
-- deliberate follow-up.
insert into role_page_visibility (role, page_key, visible) values
  ('Sales', 'appt-setter-assignments', false),
  ('Sales', 'marketing-analytics', false),
  ('Sales', 'production', false),
  ('Sales', 'documents', false),
  ('Sales', 'contracts', false)
on conflict (role, page_key) do update set visible = excluded.visible;
