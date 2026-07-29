-- Per-contact scoping for the Sales role, matching the real iBuildPro
-- product's "Appointment Setter" role: a Sales-only user (has Sales but
-- none of Office/Admin/Field/Call Center -- those broader roles keep
-- full visibility, same as the real product's "a user who also holds a
-- broader role is not restricted") only sees leads/appointments
-- assigned directly to them, or explicitly granted via Appt Setter
-- Assignments (setter_contacts), which previously had no enforcement.
--
-- Left out of this pass: sms_messages and call_logs. Their lead_id is
-- nullable and many rows are resolved to a lead by phone number at the
-- app layer rather than the FK (see reply-inbox-view.tsx), so scoping
-- those needs a separate pass to avoid hiding a sales user's own
-- inbound texts/calls that haven't been linked to a lead_id yet.

create function is_sales_only() returns boolean as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and status = 'Active'
      and 'Sales' = any(roles)
      and not ('Office' = any(roles))
      and not ('Admin' = any(roles))
      and not ('Field' = any(roles))
      and not ('Call Center' = any(roles))
  );
$$ language sql stable security definer set search_path = public;

create function lead_visible_to_current_user(check_lead_id uuid) returns boolean as $$
  select exists (
    select 1 from public.leads
    where leads.id = check_lead_id
      and (
        leads.assigned_to = auth.uid()
        or exists (
          select 1 from public.setter_contacts
          where setter_contacts.lead_id = leads.id
            and setter_contacts.setter_id = auth.uid()
        )
      )
  );
$$ language sql stable security definer set search_path = public;

-- leads
drop policy "leads_select" on leads;
create policy "leads_select" on leads for select
  to authenticated using (
    not is_sales_only()
    or assigned_to = auth.uid()
    or exists (
      select 1 from setter_contacts
      where setter_contacts.lead_id = leads.id
        and setter_contacts.setter_id = auth.uid()
    )
  );

drop policy "leads_update" on leads;
create policy "leads_update" on leads for update
  to authenticated using (
    has_role('Office')
    or (has_role('Sales') and (not is_sales_only() or lead_visible_to_current_user(id)))
  )
  with check (
    has_role('Office')
    or (has_role('Sales') and (not is_sales_only() or lead_visible_to_current_user(id)))
  );

-- events (calendar)
drop policy "events_select" on events;
create policy "events_select" on events for select
  to authenticated using (
    not is_sales_only() or assigned_to = auth.uid()
  );

-- lead-linked child tables (all have a not-null lead_id)
drop policy "lead_notes_select" on lead_notes;
create policy "lead_notes_select" on lead_notes for select
  to authenticated using (
    not is_sales_only() or lead_visible_to_current_user(lead_id)
  );

drop policy "lead_files_select" on lead_files;
create policy "lead_files_select" on lead_files for select
  to authenticated using (
    not is_sales_only() or lead_visible_to_current_user(lead_id)
  );

drop policy "lead_tasks_select" on lead_tasks;
create policy "lead_tasks_select" on lead_tasks for select
  to authenticated using (
    not is_sales_only()
    or lead_visible_to_current_user(lead_id)
    or assigned_to = auth.uid()
  );

drop policy "setter_contacts_select" on setter_contacts;
create policy "setter_contacts_select" on setter_contacts for select
  to authenticated using (
    not is_sales_only() or setter_id = auth.uid()
  );
