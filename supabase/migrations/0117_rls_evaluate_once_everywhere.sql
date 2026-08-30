begin;

-- ====================================================================
-- The rest of row security stops being evaluated once per row.
--
-- 0108 did this for leads, lead_notes, lead_tasks and setter_contacts,
-- where the cost was measured and severe: a `select * from leads`
-- filtered by these helpers took 488ms, and 7.7ms once they were
-- hoisted. It left the other 43 tables alone -- 90 policies, 191 calls
-- -- because those tables were small and the change was already large.
--
-- They are still small. This is not an emergency; it is the same defect
-- sitting under every other table in the schema, waiting for one of
-- them to grow the way leads did. company_members is currently read
-- about 150 times a second while nobody is using the app, which is 87%
-- of every row this database reads, and that is these helpers being
-- called once per row of whatever is being selected.
--
-- The shape is identical to 0108: a helper taking `company_id` -- a
-- column -- cannot be hoisted by the planner, so it runs per row and
-- each run looks up company_members. Asking instead which companies
-- the caller belongs to is one uncorrelated subquery, evaluated once
-- and hashed, and the per-row cost becomes a hash probe.
--
-- Every rewrite here was generated from the live policy definitions
-- rather than typed out, and the arguments were checked first: the only
-- negated calls are `NOT is_lead_scoped(company_id)` and
-- `NOT is_sales_only(company_id)`, and company_id is NOT NULL on every
-- table involved -- so `NOT (company_id in (...))` cannot land on the
-- NULL that would make it differ from `NOT fn(NULL)`.
-- lead_visible_to_current_user(lead_id) is never negated, so the four
-- tables with a nullable lead_id are unaffected: in a positive position
-- NULL and false are the same answer.
--
-- The scalar helpers stay. They are the readable definition of these
-- rules, application code calls some of them, and nothing here needs
-- them gone.
-- ====================================================================

-- activity_events
alter policy "activity_events_insert_self" on public.activity_events
  with check (((user_id = (select auth.uid())) AND (company_id in (select public.current_member_company_ids()))));

alter policy "activity_events_select_admin" on public.activity_events
  using (((company_id in (select public.current_role_company_ids('Office'::app_role))) OR (company_id in (select public.current_role_company_ids('Admin'::app_role)))));

-- ai_action_proposals
alter policy "ai_action_proposals_insert" on public.ai_action_proposals
  with check (((company_id in (select public.current_role_company_ids('Office'::app_role))) OR (company_id in (select public.current_role_company_ids('Admin'::app_role)))));

alter policy "ai_action_proposals_update" on public.ai_action_proposals
  using (((company_id in (select public.current_role_company_ids('Office'::app_role))) OR (company_id in (select public.current_role_company_ids('Admin'::app_role)))))
  with check (((company_id in (select public.current_role_company_ids('Office'::app_role))) OR (company_id in (select public.current_role_company_ids('Admin'::app_role)))));

-- calendars
alter policy "calendars_select" on public.calendars
  using ((company_id in (select public.current_member_company_ids())));

alter policy "calendars_write" on public.calendars
  using (((company_id in (select public.current_role_company_ids('Office'::app_role))) OR (company_id in (select public.current_role_company_ids('Admin'::app_role)))))
  with check (((company_id in (select public.current_role_company_ids('Office'::app_role))) OR (company_id in (select public.current_role_company_ids('Admin'::app_role)))));

-- call_dispositions
alter policy "call_dispositions_select" on public.call_dispositions
  using ((company_id in (select public.current_member_company_ids())));

alter policy "call_dispositions_write" on public.call_dispositions
  using (((company_id in (select public.current_role_company_ids('Office'::app_role))) OR (company_id in (select public.current_role_company_ids('Admin'::app_role)))))
  with check (((company_id in (select public.current_role_company_ids('Office'::app_role))) OR (company_id in (select public.current_role_company_ids('Admin'::app_role)))));

-- call_logs
alter policy "call_logs_insert" on public.call_logs
  with check ((company_id in (select public.current_member_company_ids())));

alter policy "call_logs_select" on public.call_logs
  using ((company_id in (select public.current_member_company_ids())));

alter policy "call_logs_update" on public.call_logs
  using ((company_id in (select public.current_member_company_ids())))
  with check ((company_id in (select public.current_member_company_ids())));

-- checklist_templates
alter policy "checklist_templates_select" on public.checklist_templates
  using ((company_id in (select public.current_member_company_ids())));

alter policy "checklist_templates_write" on public.checklist_templates
  using (((company_id in (select public.current_role_company_ids('Office'::app_role))) OR (company_id in (select public.current_role_company_ids('Admin'::app_role)))))
  with check (((company_id in (select public.current_role_company_ids('Office'::app_role))) OR (company_id in (select public.current_role_company_ids('Admin'::app_role)))));

-- companies
alter policy "companies_delete" on public.companies
  using ((id in (select public.current_role_company_ids('Office'::app_role))));

alter policy "companies_select" on public.companies
  using ((id in (select public.current_member_company_ids())));

alter policy "companies_update" on public.companies
  using ((id in (select public.current_role_company_ids('Office'::app_role))))
  with check ((id in (select public.current_role_company_ids('Office'::app_role))));

-- company_documents
alter policy "company_documents_write" on public.company_documents
  using ((company_id in (select public.current_role_company_ids('Office'::app_role))))
  with check ((company_id in (select public.current_role_company_ids('Office'::app_role))));

-- company_members
alter policy "company_members_select" on public.company_members
  using (((profile_id = (select auth.uid())) OR (company_id in (select public.current_member_company_ids()))));

alter policy "company_members_write" on public.company_members
  using (((company_id in (select public.current_role_company_ids('Office'::app_role))) OR (company_id in (select public.current_role_company_ids('Admin'::app_role)))))
  with check (((company_id in (select public.current_role_company_ids('Office'::app_role))) OR (company_id in (select public.current_role_company_ids('Admin'::app_role)))));

-- company_phone_numbers
alter policy "company_phone_numbers_select" on public.company_phone_numbers
  using ((company_id in (select public.current_member_company_ids())));

alter policy "company_phone_numbers_write" on public.company_phone_numbers
  using (((company_id in (select public.current_role_company_ids('Office'::app_role))) OR (company_id in (select public.current_role_company_ids('Admin'::app_role)))))
  with check (((company_id in (select public.current_role_company_ids('Office'::app_role))) OR (company_id in (select public.current_role_company_ids('Admin'::app_role)))));

-- company_profile
alter policy "company_profile_select" on public.company_profile
  using ((company_id in (select public.current_member_company_ids())));

alter policy "company_profile_write" on public.company_profile
  using (((company_id in (select public.current_role_company_ids('Office'::app_role))) OR (company_id in (select public.current_role_company_ids('Admin'::app_role)))))
  with check (((company_id in (select public.current_role_company_ids('Office'::app_role))) OR (company_id in (select public.current_role_company_ids('Admin'::app_role)))));

-- contract_templates
alter policy "contract_templates_write" on public.contract_templates
  using ((company_id in (select public.current_role_company_ids('Office'::app_role))))
  with check ((company_id in (select public.current_role_company_ids('Office'::app_role))));

-- contracts
alter policy "contracts_select" on public.contracts
  using ((company_id in (select public.current_member_company_ids())));

alter policy "contracts_write" on public.contracts
  using ((company_id in (select public.current_role_company_ids('Office'::app_role))))
  with check ((company_id in (select public.current_role_company_ids('Office'::app_role))));

-- dial_lists
alter policy "dial_lists_delete" on public.dial_lists
  using ((company_id in (select public.current_member_company_ids())));

alter policy "dial_lists_insert" on public.dial_lists
  with check ((company_id in (select public.current_member_company_ids())));

alter policy "dial_lists_select" on public.dial_lists
  using ((company_id in (select public.current_member_company_ids())));

-- documents
alter policy "documents_select" on public.documents
  using ((company_id in (select public.current_member_company_ids())));

alter policy "documents_write" on public.documents
  using ((company_id in (select public.current_role_company_ids('Office'::app_role))))
  with check ((company_id in (select public.current_role_company_ids('Office'::app_role))));

-- estimate_files
alter policy "estimate_files_select" on public.estimate_files
  using (((company_id in (select public.current_member_company_ids())) AND can_view_estimates_in_company(company_id)));

alter policy "estimate_files_write" on public.estimate_files
  using (((company_id in (select public.current_member_company_ids())) AND can_create_estimates_in_company(company_id)))
  with check (((company_id in (select public.current_member_company_ids())) AND can_create_estimates_in_company(company_id)));

-- estimate_groups
alter policy "estimate_groups_select" on public.estimate_groups
  using (((company_id in (select public.current_member_company_ids())) AND can_view_estimates_in_company(company_id)));

alter policy "estimate_groups_write" on public.estimate_groups
  using (((company_id in (select public.current_member_company_ids())) AND can_create_estimates_in_company(company_id)))
  with check (((company_id in (select public.current_member_company_ids())) AND can_create_estimates_in_company(company_id)));

-- estimate_items
alter policy "estimate_items_select" on public.estimate_items
  using (((company_id in (select public.current_member_company_ids())) AND can_view_estimates_in_company(company_id) AND estimate_visible_to_current_user(estimate_id)));

-- estimate_payments
alter policy "estimate_payments_select" on public.estimate_payments
  using (((company_id in (select public.current_member_company_ids())) AND can_view_estimates_in_company(company_id) AND estimate_visible_to_current_user(estimate_id)));

-- estimate_signers
alter policy "estimate_signers_select" on public.estimate_signers
  using (((company_id in (select public.current_member_company_ids())) AND can_view_estimates_in_company(company_id) AND estimate_visible_to_current_user(estimate_id)));

-- estimate_views
alter policy "estimate_views_select" on public.estimate_views
  using (((company_id in (select public.current_member_company_ids())) AND can_view_estimates_in_company(company_id)));

-- estimates
alter policy "estimates_delete" on public.estimates
  using (((company_id in (select public.current_role_company_ids('Office'::app_role))) OR (company_id in (select public.current_role_company_ids('Admin'::app_role)))));

alter policy "estimates_select" on public.estimates
  using (((company_id in (select public.current_member_company_ids())) AND can_view_estimates_in_company(company_id) AND ((NOT (company_id in (select public.current_lead_scoped_company_ids()))) OR (lead_id in (select public.current_visible_lead_ids())))));

alter policy "estimates_update" on public.estimates
  using ((can_create_estimates_in_company(company_id) AND ((NOT (company_id in (select public.current_lead_scoped_company_ids()))) OR (lead_id in (select public.current_visible_lead_ids())))));

-- events
alter policy "events_delete" on public.events
  using (((company_id in (select public.current_role_company_ids('Office'::app_role))) OR (company_id in (select public.current_role_company_ids('Admin'::app_role)))));

alter policy "events_insert" on public.events
  with check (((company_id in (select public.current_role_company_ids('Office'::app_role))) OR (company_id in (select public.current_role_company_ids('Field'::app_role))) OR ((company_id in (select public.current_role_company_ids('Sales'::app_role))) AND ((NOT (company_id in (select public.current_lead_scoped_company_ids()))) OR (assigned_to = (select auth.uid())))) OR ((company_id in (select public.current_role_company_ids('Dispatch'::app_role))) AND dispatcher_may_touch_lead(lead_id))));

alter policy "events_insert_dispatch" on public.events
  with check ((company_id in (select public.current_role_company_ids('Dispatch'::app_role))));

alter policy "events_select" on public.events
  using (((company_id in (select public.current_member_company_ids())) AND ((NOT (company_id in (select public.current_lead_scoped_company_ids()))) OR (assigned_to = (select auth.uid())) OR (lead_id in (select public.current_visible_lead_ids())) OR (company_id in (select public.current_dispatch_scoped_company_ids())))));

alter policy "events_update" on public.events
  using (((company_id in (select public.current_role_company_ids('Office'::app_role))) OR (company_id in (select public.current_role_company_ids('Field'::app_role))) OR ((company_id in (select public.current_role_company_ids('Sales'::app_role))) AND ((NOT (company_id in (select public.current_lead_scoped_company_ids()))) OR (assigned_to = (select auth.uid())))) OR ((company_id in (select public.current_role_company_ids('Dispatch'::app_role))) AND dispatcher_may_touch_lead(lead_id))))
  with check (((company_id in (select public.current_role_company_ids('Office'::app_role))) OR (company_id in (select public.current_role_company_ids('Field'::app_role))) OR ((company_id in (select public.current_role_company_ids('Sales'::app_role))) AND ((NOT (company_id in (select public.current_lead_scoped_company_ids()))) OR (assigned_to = (select auth.uid())))) OR ((company_id in (select public.current_role_company_ids('Dispatch'::app_role))) AND dispatcher_may_touch_lead(lead_id))));

alter policy "events_update_dispatch" on public.events
  using (((company_id in (select public.current_role_company_ids('Dispatch'::app_role))) AND ((company_id in (select public.current_supervisor_company_ids())) OR (lead_id IS NULL) OR (EXISTS ( SELECT 1
   FROM leads
  WHERE ((leads.id = events.lead_id) AND ((leads.dispatcher_id IS NULL) OR (leads.dispatcher_id = (select auth.uid())))))))))
  with check (((company_id in (select public.current_role_company_ids('Dispatch'::app_role))) AND ((company_id in (select public.current_supervisor_company_ids())) OR (lead_id IS NULL) OR (EXISTS ( SELECT 1
   FROM leads
  WHERE ((leads.id = events.lead_id) AND ((leads.dispatcher_id IS NULL) OR (leads.dispatcher_id = (select auth.uid())))))))));

-- job_expenses
alter policy "job_expenses_select" on public.job_expenses
  using (((company_id in (select public.current_member_company_ids())) AND can_view_estimates_in_company(company_id) AND ((NOT (company_id in (select public.current_lead_scoped_company_ids()))) OR (lead_id in (select public.current_visible_lead_ids())))));

alter policy "job_expenses_write" on public.job_expenses
  using (((company_id in (select public.current_member_company_ids())) AND can_manage_costs_in_company(company_id)))
  with check (((company_id in (select public.current_member_company_ids())) AND can_manage_costs_in_company(company_id)));

-- jobs
alter policy "jobs_select" on public.jobs
  using ((company_id in (select public.current_member_company_ids())));

alter policy "jobs_write" on public.jobs
  using (((company_id in (select public.current_role_company_ids('Office'::app_role))) OR (company_id in (select public.current_role_company_ids('Field'::app_role)))))
  with check (((company_id in (select public.current_role_company_ids('Office'::app_role))) OR (company_id in (select public.current_role_company_ids('Field'::app_role)))));

-- lead_ai_analysis
alter policy "lead_ai_analysis_select" on public.lead_ai_analysis
  using ((company_id in (select public.current_member_company_ids())));

-- lead_duplicate_dismissals
alter policy "lead_duplicate_dismissals_insert" on public.lead_duplicate_dismissals
  with check (((company_id in (select public.current_role_company_ids('Office'::app_role))) OR (company_id in (select public.current_role_company_ids('Sales'::app_role)))));

alter policy "lead_duplicate_dismissals_select" on public.lead_duplicate_dismissals
  using ((company_id in (select public.current_member_company_ids())));

-- lead_files
alter policy "lead_files_delete" on public.lead_files
  using (((company_id in (select public.current_role_company_ids('Office'::app_role))) OR (company_id in (select public.current_role_company_ids('Admin'::app_role)))));

alter policy "lead_files_insert" on public.lead_files
  with check (((company_id in (select public.current_role_company_ids('Office'::app_role))) OR (company_id in (select public.current_role_company_ids('Sales'::app_role))) OR (company_id in (select public.current_role_company_ids('Field'::app_role))) OR (company_id in (select public.current_role_company_ids('Admin'::app_role))) OR (company_id in (select public.current_role_company_ids('Production'::app_role)))));

alter policy "lead_files_select" on public.lead_files
  using (((company_id in (select public.current_member_company_ids())) AND ((NOT (company_id in (select public.current_lead_scoped_company_ids()))) OR (lead_id in (select public.current_visible_lead_ids())))));

-- lead_sources
alter policy "lead_sources_delete" on public.lead_sources
  using (((company_id in (select public.current_role_company_ids('Office'::app_role))) OR (company_id in (select public.current_role_company_ids('Admin'::app_role)))));

alter policy "lead_sources_insert" on public.lead_sources
  with check (((company_id in (select public.current_role_company_ids('Office'::app_role))) OR (company_id in (select public.current_role_company_ids('Admin'::app_role))) OR (company_id in (select public.current_role_company_ids('Sales'::app_role))) OR (company_id in (select public.current_supervisor_company_ids()))));

alter policy "lead_sources_select" on public.lead_sources
  using ((company_id in (select public.current_member_company_ids())));

alter policy "lead_sources_update" on public.lead_sources
  using (((company_id in (select public.current_role_company_ids('Office'::app_role))) OR (company_id in (select public.current_role_company_ids('Admin'::app_role)))))
  with check (((company_id in (select public.current_role_company_ids('Office'::app_role))) OR (company_id in (select public.current_role_company_ids('Admin'::app_role)))));

-- lead_trash
alter policy "lead_trash_select" on public.lead_trash
  using (((company_id in (select public.current_role_company_ids('Admin'::app_role))) OR (company_id in (select public.current_lead_delete_company_ids()))));

-- lead_views
alter policy "admins can read the trail" on public.lead_views
  using ((company_id in (select public.current_role_company_ids('Admin'::app_role))));

-- pipeline_stages
alter policy "pipeline_stages_select" on public.pipeline_stages
  using ((company_id in (select public.current_member_company_ids())));

alter policy "pipeline_stages_write" on public.pipeline_stages
  using (((company_id in (select public.current_role_company_ids('Office'::app_role))) OR (company_id in (select public.current_role_company_ids('Admin'::app_role)))))
  with check (((company_id in (select public.current_role_company_ids('Office'::app_role))) OR (company_id in (select public.current_role_company_ids('Admin'::app_role)))));

-- portal_payments
alter policy "portal_payments_select" on public.portal_payments
  using (((company_id in (select public.current_member_company_ids())) AND can_view_estimates_in_company(company_id) AND estimate_visible_to_current_user(estimate_id)));

-- project_checklist_items
alter policy "project_checklist_items_delete" on public.project_checklist_items
  using (((company_id in (select public.current_role_company_ids('Office'::app_role))) OR (company_id in (select public.current_role_company_ids('Admin'::app_role)))));

alter policy "project_checklist_items_insert" on public.project_checklist_items
  with check (((company_id in (select public.current_role_company_ids('Office'::app_role))) OR (company_id in (select public.current_role_company_ids('Admin'::app_role)))));

alter policy "project_checklist_items_select" on public.project_checklist_items
  using ((company_id in (select public.current_member_company_ids())));

alter policy "project_checklist_items_update" on public.project_checklist_items
  using ((company_id in (select public.current_member_company_ids())))
  with check ((company_id in (select public.current_member_company_ids())));

-- project_types
alter policy "project_types_delete" on public.project_types
  using (((company_id in (select public.current_role_company_ids('Office'::app_role))) OR (company_id in (select public.current_role_company_ids('Admin'::app_role)))));

alter policy "project_types_insert" on public.project_types
  with check (((company_id in (select public.current_role_company_ids('Office'::app_role))) OR (company_id in (select public.current_role_company_ids('Admin'::app_role))) OR (company_id in (select public.current_role_company_ids('Sales'::app_role)))));

alter policy "project_types_select" on public.project_types
  using ((company_id in (select public.current_member_company_ids())));

alter policy "project_types_update" on public.project_types
  using (((company_id in (select public.current_role_company_ids('Office'::app_role))) OR (company_id in (select public.current_role_company_ids('Admin'::app_role)))))
  with check (((company_id in (select public.current_role_company_ids('Office'::app_role))) OR (company_id in (select public.current_role_company_ids('Admin'::app_role)))));

-- property_reports
alter policy "property_reports_select" on public.property_reports
  using ((company_id in (select public.current_member_company_ids())));

-- role_page_visibility
alter policy "role_page_visibility_select" on public.role_page_visibility
  using ((company_id in (select public.current_member_company_ids())));

alter policy "role_page_visibility_write" on public.role_page_visibility
  using (((company_id in (select public.current_role_company_ids('Office'::app_role))) OR (company_id in (select public.current_role_company_ids('Admin'::app_role)))))
  with check (((company_id in (select public.current_role_company_ids('Office'::app_role))) OR (company_id in (select public.current_role_company_ids('Admin'::app_role)))));

-- scope_templates
alter policy "scope_templates_select" on public.scope_templates
  using (((company_id in (select public.current_member_company_ids())) AND can_view_estimates_in_company(company_id)));

-- screen_shares
alter policy "screen_shares_insert" on public.screen_shares
  with check (((company_id in (select public.current_member_company_ids())) AND (sharer_id = (select auth.uid()))));

alter policy "screen_shares_select" on public.screen_shares
  using (((company_id in (select public.current_member_company_ids())) AND ((invited_to IS NULL) OR (invited_to = (select auth.uid())) OR (sharer_id = (select auth.uid())))));

-- sms_messages
alter policy "sms_messages_insert_dispatch" on public.sms_messages
  with check (((direction = 'outbound'::text) AND ((company_id in (select public.current_role_company_ids('Dispatch'::app_role))) OR (company_id in (select public.current_role_company_ids('Call Center'::app_role))))));

alter policy "sms_messages_insert_outbound" on public.sms_messages
  with check (((direction = 'outbound'::text) AND ((company_id in (select public.current_role_company_ids('Office'::app_role))) OR (company_id in (select public.current_role_company_ids('Sales'::app_role))) OR (company_id in (select public.current_role_company_ids('Dispatch'::app_role))) OR (company_id in (select public.current_role_company_ids('Call Center'::app_role))))));

alter policy "sms_messages_select" on public.sms_messages
  using ((company_id in (select public.current_member_company_ids())));

-- sms_quick_texts
alter policy "sms_quick_texts_select" on public.sms_quick_texts
  using ((company_id in (select public.current_member_company_ids())));

alter policy "sms_quick_texts_write" on public.sms_quick_texts
  using (((company_id in (select public.current_role_company_ids('Office'::app_role))) OR (company_id in (select public.current_role_company_ids('Admin'::app_role)))))
  with check (((company_id in (select public.current_role_company_ids('Office'::app_role))) OR (company_id in (select public.current_role_company_ids('Admin'::app_role)))));

-- user_devices
alter policy "user_devices_select" on public.user_devices
  using (((profile_id = (select auth.uid())) OR (company_id in (select public.current_role_company_ids('Office'::app_role)))));

alter policy "user_devices_update" on public.user_devices
  using (((profile_id = (select auth.uid())) OR (company_id in (select public.current_role_company_ids('Office'::app_role)))))
  with check (((profile_id = (select auth.uid())) OR (company_id in (select public.current_role_company_ids('Office'::app_role)))));

-- vendors
alter policy "vendors_select" on public.vendors
  using ((company_id in (select public.current_member_company_ids())));

alter policy "vendors_write" on public.vendors
  using (((company_id in (select public.current_member_company_ids())) AND can_manage_costs_in_company(company_id)))
  with check (((company_id in (select public.current_member_company_ids())) AND can_manage_costs_in_company(company_id)));

commit;
