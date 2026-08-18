-- 0094: Dispatch Supervisor -- a dispatcher who runs the desk.
--
-- A per-member flag on company_members, same shape as can_delete_leads
-- and the estimate toggles, rather than a new app_role enum value: the
-- supervisor keeps the Dispatch role, so every policy that already
-- grants Dispatch its daily work (notes, tasks, texting, booking)
-- carries over untouched, and only the additions below are new.
--
-- No begin/commit, after 0070: one failing statement in a wrapped block
-- rolled everything back while the editor reported nothing. Run as one
-- paste; the proof select at the end says what actually landed.

alter table company_members
  add column if not exists is_dispatch_supervisor boolean not null default false;

create or replace function is_dispatch_supervisor(check_company_id uuid) returns boolean as $$
  select exists (
    select 1 from public.company_members cm
    where cm.profile_id = auth.uid()
      and cm.company_id = check_company_id
      and cm.status = 'Active'
      and cm.is_dispatch_supervisor
      and 'Dispatch' = any(cm.roles::text[])
  );
$$ language sql stable security definer set search_path = public;

-- Supervisors see the whole book. Every lead-scoped policy (events,
-- notes, tasks, estimates) delegates to this function via
-- is_lead_scoped, so one change unscopes all of it at once.
create or replace function is_dispatch_scoped(check_company_id uuid) returns boolean as $$
  select exists (
    select 1 from public.company_members cm
    where cm.profile_id = auth.uid()
      and cm.company_id = check_company_id
      and cm.status = 'Active'
      and 'Dispatch' = any(cm.roles::text[])
      and not cm.is_dispatch_supervisor
      and not (cm.roles::text[] && array['Office', 'Admin'])
  );
$$ language sql stable security definer set search_path = public;

-- Entering new leads and new sources: what the supervisor is for.
alter policy "leads_insert" on leads
  with check (
    has_role_in_company('Office', company_id)
    or has_role_in_company('Sales', company_id)
    or public.is_dispatch_supervisor(company_id)
  );

alter policy "lead_sources_insert" on lead_sources
  with check (
    has_role_in_company('Office', company_id)
    or has_role_in_company('Admin', company_id)
    or has_role_in_company('Sales', company_id)
    or public.is_dispatch_supervisor(company_id)
  );

-- Edit any lead and assign any dispatcher. A plain dispatcher may only
-- claim unclaimed leads or work their own.
alter policy "leads_update" on leads
  using (
    has_role_in_company('Office', company_id)
    or (has_role_in_company('Sales', company_id) and (not is_sales_only(company_id) or lead_visible_to_current_user(id)))
    or (
      has_role_in_company('Dispatch', company_id)
      and (dispatcher_id = auth.uid() or dispatcher_id is null)
    )
    or public.is_dispatch_supervisor(company_id)
  )
  with check (
    has_role_in_company('Office', company_id)
    or (has_role_in_company('Sales', company_id) and (not is_sales_only(company_id) or lead_visible_to_current_user(id)))
    or (
      has_role_in_company('Dispatch', company_id)
      and (dispatcher_id = auth.uid() or dispatcher_id is null)
    )
    or public.is_dispatch_supervisor(company_id)
  );

-- Work any appointment on the dispatch calendar, not only own/unclaimed.
alter policy "events_update_dispatch" on events
  using (
    has_role_in_company('Dispatch'::app_role, company_id)
    and (
      public.is_dispatch_supervisor(company_id)
      or lead_id is null
      or exists (
        select 1 from public.leads
        where leads.id = events.lead_id
          and (leads.dispatcher_id is null or leads.dispatcher_id = auth.uid())
      )
    )
  )
  with check (
    has_role_in_company('Dispatch'::app_role, company_id)
    and (
      public.is_dispatch_supervisor(company_id)
      or lead_id is null
      or exists (
        select 1 from public.leads
        where leads.id = events.lead_id
          and (leads.dispatcher_id is null or leads.dispatcher_id = auth.uid())
      )
    )
  );

-- Proof rather than a success message.
select
  (select count(*) from information_schema.columns
    where table_name = 'company_members' and column_name = 'is_dispatch_supervisor') as column_added,
  (select count(*) from pg_proc where proname = 'is_dispatch_supervisor') as helper_fn,
  (select count(*) from pg_policies
    where tablename = 'leads' and policyname = 'leads_insert'
      and with_check like '%is_dispatch_supervisor%') as leads_insert_updated,
  (select count(*) from pg_policies
    where tablename = 'lead_sources' and policyname = 'lead_sources_insert'
      and with_check like '%is_dispatch_supervisor%') as sources_insert_updated;
