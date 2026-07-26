-- Permission rules for the new Admin/Sales roles. Run this AFTER
-- 0006_add_admin_sales_roles.sql has been committed.
--
-- Admin: gets Admin Settings access (company profile, users & roles)
--   alongside whatever Office already has.
-- Sales: gets Dispatch-section access (leads, follow-up tasks, booking
--   appointments, setter assignments) but cannot delete leads unless
--   an Admin/Office user turns on their per-user can_delete_leads flag.

alter table profiles add column can_delete_leads boolean not null default false;

create function can_delete_lead() returns boolean as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and status = 'Active'
      and (
        'Office' = any(roles)
        or ('Sales' = any(roles) and can_delete_leads = true)
      )
  );
$$ language sql stable security definer set search_path = public;

-- Admin Settings: Office or Admin
drop policy "company_profile_write" on company_profile;
create policy "company_profile_write" on company_profile for update
  to authenticated using (has_role('Office') or has_role('Admin'))
  with check (has_role('Office') or has_role('Admin'));

drop policy "profiles_office_manage" on profiles;
create policy "profiles_office_manage" on profiles for all
  to authenticated using (has_role('Office') or has_role('Admin'))
  with check (has_role('Office') or has_role('Admin'));

-- Leads: Office or Sales can insert/update; delete requires Office, or
-- Sales with the per-user can_delete_leads flag turned on.
drop policy "leads_write" on leads;
create policy "leads_insert" on leads for insert
  to authenticated with check (has_role('Office') or has_role('Sales'));
create policy "leads_update" on leads for update
  to authenticated using (has_role('Office') or has_role('Sales'))
  with check (has_role('Office') or has_role('Sales'));
create policy "leads_delete" on leads for delete
  to authenticated using (can_delete_lead());

-- Follow-up tasks: Office or Sales
drop policy "lead_tasks_write" on lead_tasks;
create policy "lead_tasks_write" on lead_tasks for all
  to authenticated using (has_role('Office') or has_role('Sales'))
  with check (has_role('Office') or has_role('Sales'));

-- Appointments: Office, Field, or Sales (Sales needs this so "Book
-- Appointment" from a lead works)
drop policy "events_write" on events;
create policy "events_write" on events for all
  to authenticated using (has_role('Office') or has_role('Field') or has_role('Sales'))
  with check (has_role('Office') or has_role('Field') or has_role('Sales'));

-- Setter contact assignments: Office or Sales
drop policy "setter_contacts_write" on setter_contacts;
create policy "setter_contacts_write" on setter_contacts for all
  to authenticated using (has_role('Office') or has_role('Sales'))
  with check (has_role('Office') or has_role('Sales'));
