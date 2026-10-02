-- A super admin's activity is seen by super admins only
-- (canSeeActivityOf, src/lib/data/activity-visibility.ts).
--
-- Page visits (activity_events) and contact opens (lead_views) are what
-- Team Activity, the who's-online panel and a contact card's "Last
-- opened by" are built from. Office and Admin can read activity_events,
-- and Admin lead_views, straight through the API, so hiding a super
-- admin on the screens alone is not the line. This is:
--
--   1. super_admin_profile_ids() -- the super admins the caller can see.
--      Security INVOKER on purpose: it reads profiles under the caller's
--      own RLS, so it hands nobody an id they could not already read
--      (a definer version would list every super admin on the platform
--      to anyone who called it). A super admin always sees their own
--      profile, which is how the policy below recognises one.
--   2. super_admin_activity_hidden on both tables -- restrictive, so it
--      narrows the Office/Admin read policies without rewriting them,
--      the same shape as billing_lock (0175). A super admin's rows are
--      returned only to a super admin. The service role is unaffected;
--      the reports that read with it apply the same rule in code
--      (hiddenActivityUserIds), which also covers the time before this
--      file runs.
--   3. The super admin activity recorded so far is deleted (owner's
--      call, 2026-10-02).
--
-- Safe as one paste and safe to run again -- but a second run deletes
-- again whatever super admin activity was recorded since the first,
-- which only a super admin could see anyway.
begin;

create or replace function public.super_admin_profile_ids()
returns setof uuid
language sql
stable
set search_path to 'public'
as $$
  select id from profiles where is_super_admin
$$;

drop policy if exists super_admin_activity_hidden on public.activity_events;
create policy super_admin_activity_hidden on public.activity_events
  as restrictive for select to authenticated
  using (
    user_id not in (select public.super_admin_profile_ids())
    or (select auth.uid()) in (select public.super_admin_profile_ids())
  );

drop policy if exists super_admin_activity_hidden on public.lead_views;
create policy super_admin_activity_hidden on public.lead_views
  as restrictive for select to authenticated
  using (
    user_id not in (select public.super_admin_profile_ids())
    or (select auth.uid()) in (select public.super_admin_profile_ids())
  );

delete from public.activity_events where user_id in (select public.super_admin_profile_ids());
delete from public.lead_views where user_id in (select public.super_admin_profile_ids());

commit;

-- Verify: expect hiding_policies = 2 and both counts 0 (a few page visits
-- can reappear at once if a super admin has the CRM open right now --
-- those are hidden from everyone else).
select
  (select count(*) from pg_policy where polname = 'super_admin_activity_hidden') as hiding_policies,
  (select count(*) from public.activity_events where user_id in (select public.super_admin_profile_ids())) as super_admin_page_visits_left,
  (select count(*) from public.lead_views where user_id in (select public.super_admin_profile_ids())) as super_admin_contact_opens_left;
