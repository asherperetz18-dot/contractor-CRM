-- Multi-company support, step 4 of 4: RLS rewrite.
--
-- Every policy up to this point checks role/ownership globally via
-- has_role()/is_sales_only()/can_delete_lead(), which read profiles.roles
-- directly. 0033 introduced company_members as the real source of truth
-- (one row per profile+company, so a person can hold different roles in
-- different companies) but nothing has consulted it yet -- every table
-- with a company_id column (added in 0033, backfilled in 0034, made
-- required in 0035) has been readable/writable across company
-- boundaries by anyone with the right global role. This migration closes
-- that gap.
--
-- Also fixes, as part of the same pass (not optional -- leaving these
-- open defeats isolation regardless of what else is fixed):
--   - call_logs / dial_lists: previously `using (true)` with zero role
--     gating at all.
--   - company_profile: previously `using (true)` on select, which
--     exposed webhook_secret / meta_page_access_token / meta_app_secret
--     across every company to any authenticated user.
--   - profiles: previously `using (true)` on select, exposing every
--     user's name/email/phone across every company.
--   - companies: previously `using (true)` on select.
--   - company_members: RLS was enabled with zero policies at all, so
--     the app's normal client couldn't read it -- needed real policies
--     to actually function as the permission source of truth.
--
-- Pattern used throughout: has_role_in_company(role, company_id) and
-- is_member_of_company(company_id) replace has_role()/implicit "any
-- authenticated user"; is_sales_only(company_id) and
-- can_delete_lead_in_company(company_id) replace their 0-arg
-- equivalents. lead_visible_to_current_user(lead_id) is unchanged --
-- it's inherently scoped to one specific lead already.
--
-- The old has_role()/is_sales_only()/can_delete_lead() are dropped at
-- the very end. If any policy below still referenced one of them by
-- mistake, that drop fails and the whole migration rolls back -- a
-- built-in check that nothing was missed.
begin;

-- ── New company-aware helper functions ──────────────────────────────

create function has_role_in_company(check_role app_role, check_company_id uuid) returns boolean as $$
  select exists (
    select 1 from public.company_members
    where profile_id = auth.uid()
      and company_id = check_company_id
      and check_role = any(roles)
      and status = 'Active'
  );
$$ language sql stable security definer set search_path = public;

create function is_member_of_company(check_company_id uuid) returns boolean as $$
  select exists (
    select 1 from public.company_members
    where profile_id = auth.uid()
      and company_id = check_company_id
      and status = 'Active'
  );
$$ language sql stable security definer set search_path = public;

create function is_sales_only(check_company_id uuid) returns boolean as $$
  select exists (
    select 1 from public.company_members
    where profile_id = auth.uid()
      and company_id = check_company_id
      and status = 'Active'
      and 'Sales' = any(roles)
      and not ('Office' = any(roles))
      and not ('Admin' = any(roles))
      and not ('Field' = any(roles))
      and not ('Call Center' = any(roles))
  );
$$ language sql stable security definer set search_path = public;

create function can_delete_lead_in_company(check_company_id uuid) returns boolean as $$
  select exists (
    select 1 from public.company_members
    where profile_id = auth.uid()
      and company_id = check_company_id
      and status = 'Active'
      and (
        'Office' = any(roles)
        or ('Sales' = any(roles) and can_delete_leads = true)
      )
  );
$$ language sql stable security definer set search_path = public;

-- ── activity_events ──────────────────────────────────────────────────
drop policy "activity_events_select_admin" on activity_events;
create policy "activity_events_select_admin" on activity_events for select
  to authenticated using (
    has_role_in_company('Office', company_id) or has_role_in_company('Admin', company_id)
  );

drop policy "activity_events_insert_self" on activity_events;
create policy "activity_events_insert_self" on activity_events for insert
  to authenticated with check (user_id = auth.uid() and is_member_of_company(company_id));

-- ── calendars ────────────────────────────────────────────────────────
drop policy "calendars_select" on calendars;
create policy "calendars_select" on calendars for select
  to authenticated using (is_member_of_company(company_id));

drop policy "calendars_write" on calendars;
create policy "calendars_write" on calendars for all
  to authenticated using (has_role_in_company('Office', company_id) or has_role_in_company('Admin', company_id))
  with check (has_role_in_company('Office', company_id) or has_role_in_company('Admin', company_id));

-- ── call_dispositions ────────────────────────────────────────────────
drop policy "call_dispositions_select" on call_dispositions;
create policy "call_dispositions_select" on call_dispositions for select
  to authenticated using (is_member_of_company(company_id));

drop policy "call_dispositions_write" on call_dispositions;
create policy "call_dispositions_write" on call_dispositions for all
  to authenticated using (has_role_in_company('Office', company_id) or has_role_in_company('Admin', company_id))
  with check (has_role_in_company('Office', company_id) or has_role_in_company('Admin', company_id));

-- ── call_logs (was wide open) ───────────────────────────────────────
drop policy "call_logs_select" on call_logs;
create policy "call_logs_select" on call_logs for select
  to authenticated using (is_member_of_company(company_id));

drop policy "call_logs_insert" on call_logs;
create policy "call_logs_insert" on call_logs for insert
  to authenticated with check (is_member_of_company(company_id));

drop policy "call_logs_update" on call_logs;
create policy "call_logs_update" on call_logs for update
  to authenticated using (is_member_of_company(company_id)) with check (is_member_of_company(company_id));

-- ── companies ────────────────────────────────────────────────────────
drop policy "companies_select" on companies;
create policy "companies_select" on companies for select
  to authenticated using (is_member_of_company(id));

drop policy "companies_write" on companies;
create policy "companies_update" on companies for update
  to authenticated using (has_role_in_company('Office', id)) with check (has_role_in_company('Office', id));
create policy "companies_delete" on companies for delete
  to authenticated using (has_role_in_company('Office', id));
-- Deliberately no insert policy for `authenticated` -- a brand new
-- company has no company_members row yet for anyone to check against,
-- so creation goes through the service-role admin client only.

-- ── company_members (had zero policies -- unusable from the app client) ─
create policy "company_members_select" on company_members for select
  to authenticated using (
    profile_id = auth.uid()
    or has_role_in_company('Office', company_id)
    or has_role_in_company('Admin', company_id)
  );
create policy "company_members_write" on company_members for all
  to authenticated using (has_role_in_company('Office', company_id) or has_role_in_company('Admin', company_id))
  with check (has_role_in_company('Office', company_id) or has_role_in_company('Admin', company_id));
-- Same bootstrap consideration as companies: the very first member of a
-- brand new company is created by the service-role admin client.

-- ── company_profile ──────────────────────────────────────────────────
drop policy "company_profile_select" on company_profile;
create policy "company_profile_select" on company_profile for select
  to authenticated using (is_member_of_company(company_id));

drop policy "company_profile_write" on company_profile;
create policy "company_profile_write" on company_profile for update
  to authenticated using (has_role_in_company('Office', company_id) or has_role_in_company('Admin', company_id))
  with check (has_role_in_company('Office', company_id) or has_role_in_company('Admin', company_id));

-- ── contracts ────────────────────────────────────────────────────────
drop policy "contracts_select" on contracts;
create policy "contracts_select" on contracts for select
  to authenticated using (is_member_of_company(company_id));

drop policy "contracts_write" on contracts;
create policy "contracts_write" on contracts for all
  to authenticated using (has_role_in_company('Office', company_id))
  with check (has_role_in_company('Office', company_id));

-- ── dial_lists (was wide open) ──────────────────────────────────────
drop policy "dial_lists_select" on dial_lists;
create policy "dial_lists_select" on dial_lists for select
  to authenticated using (is_member_of_company(company_id));

drop policy "dial_lists_insert" on dial_lists;
create policy "dial_lists_insert" on dial_lists for insert
  to authenticated with check (is_member_of_company(company_id));

drop policy "dial_lists_delete" on dial_lists;
create policy "dial_lists_delete" on dial_lists for delete
  to authenticated using (is_member_of_company(company_id));

-- ── documents ────────────────────────────────────────────────────────
drop policy "documents_select" on documents;
create policy "documents_select" on documents for select
  to authenticated using (is_member_of_company(company_id));

drop policy "documents_write" on documents;
create policy "documents_write" on documents for all
  to authenticated using (has_role_in_company('Office', company_id))
  with check (has_role_in_company('Office', company_id));

-- ── events ───────────────────────────────────────────────────────────
drop policy "events_select" on events;
create policy "events_select" on events for select
  to authenticated using (
    is_member_of_company(company_id)
    and (not is_sales_only(company_id) or assigned_to = auth.uid())
  );

drop policy "events_write" on events;
create policy "events_write" on events for all
  to authenticated using (
    has_role_in_company('Office', company_id) or has_role_in_company('Field', company_id)
    or (has_role_in_company('Sales', company_id) and (not is_sales_only(company_id) or assigned_to = auth.uid()))
  )
  with check (
    has_role_in_company('Office', company_id) or has_role_in_company('Field', company_id)
    or (has_role_in_company('Sales', company_id) and (not is_sales_only(company_id) or assigned_to = auth.uid()))
  );

-- ── jobs ─────────────────────────────────────────────────────────────
drop policy "jobs_select" on jobs;
create policy "jobs_select" on jobs for select
  to authenticated using (is_member_of_company(company_id));

drop policy "jobs_write" on jobs;
create policy "jobs_write" on jobs for all
  to authenticated using (has_role_in_company('Office', company_id) or has_role_in_company('Field', company_id))
  with check (has_role_in_company('Office', company_id) or has_role_in_company('Field', company_id));

-- ── lead_files ───────────────────────────────────────────────────────
drop policy "lead_files_select" on lead_files;
create policy "lead_files_select" on lead_files for select
  to authenticated using (
    is_member_of_company(company_id)
    and (not is_sales_only(company_id) or lead_visible_to_current_user(lead_id))
  );

drop policy "lead_files_insert" on lead_files;
create policy "lead_files_insert" on lead_files for insert
  to authenticated with check (
    has_role_in_company('Office', company_id)
    or has_role_in_company('Sales', company_id)
    or has_role_in_company('Field', company_id)
  );

drop policy "lead_files_delete" on lead_files;
create policy "lead_files_delete" on lead_files for delete
  to authenticated using (has_role_in_company('Office', company_id) or has_role_in_company('Admin', company_id));

-- ── lead_notes ───────────────────────────────────────────────────────
drop policy "lead_notes_select" on lead_notes;
create policy "lead_notes_select" on lead_notes for select
  to authenticated using (
    is_member_of_company(company_id)
    and (not is_sales_only(company_id) or lead_visible_to_current_user(lead_id))
  );

drop policy "lead_notes_insert" on lead_notes;
create policy "lead_notes_insert" on lead_notes for insert
  to authenticated with check (
    has_role_in_company('Office', company_id)
    or has_role_in_company('Sales', company_id)
    or has_role_in_company('Field', company_id)
  );

drop policy "lead_notes_delete" on lead_notes;
create policy "lead_notes_delete" on lead_notes for delete
  to authenticated using (has_role_in_company('Office', company_id) or has_role_in_company('Admin', company_id));

-- ── lead_sources ─────────────────────────────────────────────────────
drop policy "lead_sources_select" on lead_sources;
create policy "lead_sources_select" on lead_sources for select
  to authenticated using (is_member_of_company(company_id));

drop policy "lead_sources_insert" on lead_sources;
create policy "lead_sources_insert" on lead_sources for insert
  to authenticated with check (
    has_role_in_company('Office', company_id)
    or has_role_in_company('Admin', company_id)
    or has_role_in_company('Sales', company_id)
  );

drop policy "lead_sources_update" on lead_sources;
create policy "lead_sources_update" on lead_sources for update
  to authenticated using (has_role_in_company('Office', company_id) or has_role_in_company('Admin', company_id))
  with check (has_role_in_company('Office', company_id) or has_role_in_company('Admin', company_id));

drop policy "lead_sources_delete" on lead_sources;
create policy "lead_sources_delete" on lead_sources for delete
  to authenticated using (has_role_in_company('Office', company_id) or has_role_in_company('Admin', company_id));

-- ── lead_tasks ───────────────────────────────────────────────────────
drop policy "lead_tasks_select" on lead_tasks;
create policy "lead_tasks_select" on lead_tasks for select
  to authenticated using (
    is_member_of_company(company_id)
    and (
      not is_sales_only(company_id)
      or lead_visible_to_current_user(lead_id)
      or assigned_to = auth.uid()
    )
  );

drop policy "lead_tasks_write" on lead_tasks;
create policy "lead_tasks_write" on lead_tasks for all
  to authenticated using (
    has_role_in_company('Office', company_id)
    or (has_role_in_company('Sales', company_id) and (
      not is_sales_only(company_id)
      or lead_visible_to_current_user(lead_id)
      or assigned_to = auth.uid()
    ))
  )
  with check (
    has_role_in_company('Office', company_id)
    or (has_role_in_company('Sales', company_id) and (
      not is_sales_only(company_id)
      or lead_visible_to_current_user(lead_id)
      or assigned_to = auth.uid()
    ))
  );

-- ── leads ────────────────────────────────────────────────────────────
drop policy "leads_select" on leads;
create policy "leads_select" on leads for select
  to authenticated using (
    is_member_of_company(company_id)
    and (
      not is_sales_only(company_id)
      or assigned_to = auth.uid()
      or exists (
        select 1 from setter_contacts
        where setter_contacts.lead_id = leads.id
          and setter_contacts.setter_id = auth.uid()
      )
    )
  );

drop policy "leads_insert" on leads;
create policy "leads_insert" on leads for insert
  to authenticated with check (
    has_role_in_company('Office', company_id) or has_role_in_company('Sales', company_id)
  );

drop policy "leads_update" on leads;
create policy "leads_update" on leads for update
  to authenticated using (
    has_role_in_company('Office', company_id)
    or (has_role_in_company('Sales', company_id) and (not is_sales_only(company_id) or lead_visible_to_current_user(id)))
  )
  with check (
    has_role_in_company('Office', company_id)
    or (has_role_in_company('Sales', company_id) and (not is_sales_only(company_id) or lead_visible_to_current_user(id)))
  );

drop policy "leads_delete" on leads;
create policy "leads_delete" on leads for delete
  to authenticated using (can_delete_lead_in_company(company_id));

-- ── pipeline_stages ──────────────────────────────────────────────────
drop policy "pipeline_stages_select" on pipeline_stages;
create policy "pipeline_stages_select" on pipeline_stages for select
  to authenticated using (is_member_of_company(company_id));

drop policy "pipeline_stages_write" on pipeline_stages;
create policy "pipeline_stages_write" on pipeline_stages for all
  to authenticated using (has_role_in_company('Office', company_id) or has_role_in_company('Admin', company_id))
  with check (has_role_in_company('Office', company_id) or has_role_in_company('Admin', company_id));

-- ── profiles (no company_id column -- identity-only; scope via company_members) ─
drop policy "profiles_select" on profiles;
create policy "profiles_select" on profiles for select
  to authenticated using (
    auth.uid() = id
    or exists (
      select 1 from company_members cm_self
      join company_members cm_other on cm_other.company_id = cm_self.company_id
      where cm_self.profile_id = auth.uid()
        and cm_other.profile_id = profiles.id
    )
  );

drop policy "profiles_office_manage" on profiles;
create policy "profiles_office_manage" on profiles for all
  to authenticated using (
    exists (
      select 1 from company_members cm_self
      join company_members cm_other on cm_other.company_id = cm_self.company_id
      where cm_self.profile_id = auth.uid()
        and cm_other.profile_id = profiles.id
        and ('Office' = any(cm_self.roles) or 'Admin' = any(cm_self.roles))
    )
  )
  with check (
    exists (
      select 1 from company_members cm_self
      join company_members cm_other on cm_other.company_id = cm_self.company_id
      where cm_self.profile_id = auth.uid()
        and cm_other.profile_id = profiles.id
        and ('Office' = any(cm_self.roles) or 'Admin' = any(cm_self.roles))
    )
  );
-- profiles_update_self is untouched -- auth.uid() = id needs no company scoping.

-- ── project_types ────────────────────────────────────────────────────
drop policy "project_types_select" on project_types;
create policy "project_types_select" on project_types for select
  to authenticated using (is_member_of_company(company_id));

drop policy "project_types_insert" on project_types;
create policy "project_types_insert" on project_types for insert
  to authenticated with check (
    has_role_in_company('Office', company_id)
    or has_role_in_company('Admin', company_id)
    or has_role_in_company('Sales', company_id)
  );

drop policy "project_types_update" on project_types;
create policy "project_types_update" on project_types for update
  to authenticated using (has_role_in_company('Office', company_id) or has_role_in_company('Admin', company_id))
  with check (has_role_in_company('Office', company_id) or has_role_in_company('Admin', company_id));

drop policy "project_types_delete" on project_types;
create policy "project_types_delete" on project_types for delete
  to authenticated using (has_role_in_company('Office', company_id) or has_role_in_company('Admin', company_id));

-- ── role_page_visibility ─────────────────────────────────────────────
drop policy "role_page_visibility_select" on role_page_visibility;
create policy "role_page_visibility_select" on role_page_visibility for select
  to authenticated using (is_member_of_company(company_id));

drop policy "role_page_visibility_write" on role_page_visibility;
create policy "role_page_visibility_write" on role_page_visibility for all
  to authenticated using (has_role_in_company('Office', company_id) or has_role_in_company('Admin', company_id))
  with check (has_role_in_company('Office', company_id) or has_role_in_company('Admin', company_id));

-- ── setter_contacts ──────────────────────────────────────────────────
drop policy "setter_contacts_select" on setter_contacts;
create policy "setter_contacts_select" on setter_contacts for select
  to authenticated using (
    is_member_of_company(company_id)
    and (not is_sales_only(company_id) or setter_id = auth.uid())
  );

drop policy "setter_contacts_write" on setter_contacts;
create policy "setter_contacts_write" on setter_contacts for all
  to authenticated using (
    has_role_in_company('Office', company_id)
    or (has_role_in_company('Sales', company_id) and (not is_sales_only(company_id) or setter_id = auth.uid()))
  )
  with check (
    has_role_in_company('Office', company_id)
    or (has_role_in_company('Sales', company_id) and (not is_sales_only(company_id) or setter_id = auth.uid()))
  );

-- ── sms_messages ─────────────────────────────────────────────────────
drop policy "sms_messages_select" on sms_messages;
create policy "sms_messages_select" on sms_messages for select
  to authenticated using (is_member_of_company(company_id));

drop policy "sms_messages_insert_outbound" on sms_messages;
create policy "sms_messages_insert_outbound" on sms_messages for insert
  to authenticated with check (
    direction = 'outbound'
    and (has_role_in_company('Office', company_id) or has_role_in_company('Sales', company_id))
  );

-- ── sms_quick_texts ──────────────────────────────────────────────────
drop policy "sms_quick_texts_select" on sms_quick_texts;
create policy "sms_quick_texts_select" on sms_quick_texts for select
  to authenticated using (is_member_of_company(company_id));

drop policy "sms_quick_texts_write" on sms_quick_texts;
create policy "sms_quick_texts_write" on sms_quick_texts for all
  to authenticated using (has_role_in_company('Office', company_id) or has_role_in_company('Admin', company_id))
  with check (has_role_in_company('Office', company_id) or has_role_in_company('Admin', company_id));

-- ── Drop the now-obsolete global functions ──────────────────────────
-- Fails (rolling back the whole migration) if anything above still
-- references one of these -- a built-in completeness check.
drop function has_role(app_role);
drop function is_sales_only();
drop function can_delete_lead();

commit;
