-- Accounts are changed by their owner or by the server -- never by
-- another company, and never into a platform admin.
--
-- profiles holds the flags that open every company at once
-- (is_platform_admin, which 0132's trigger turns into Office+Admin
-- memberships everywhere, and is_super_admin) and the email that signup
-- and the platform-admin grant look people up by. Until now:
--
--   1. profiles_update_self let a signed-in person write ANY column of
--      their own row through the API -- the flags and the email included.
--   2. profiles_office_manage (0036) let Office/Admin insert, update and
--      delete the profile of anyone holding a membership row in one of
--      their companies -- and company_members_write lets them add such a
--      row for any profile id.
--   3. revoke_platform_admin_if_not_last (0132) is SECURITY DEFINER and,
--      like every function here, executable by anon and authenticated by
--      default -- with no check on who is calling.
--
-- After this file:
--
--   1. The API can update exactly four columns of profiles, and only on
--      the caller's own row (profiles_update_self still decides whose):
--      name, phone, and the two layout preferences the app saves as the
--      signed-in person (lib/actions/funnel-order.ts, dashboard.ts).
--      Everything else -- the admin flags, email, the legacy roles/status/
--      company_id columns -- is written only by the service role, which is
--      what updateUserProfile, createUser, signup and grantPlatformAdmin
--      already use. src/lib/data/profile-write-lockdown.test.ts fails if a
--      signed-in write to any other column appears in the code.
--   2. profiles_office_manage is gone. Reading co-workers is
--      profiles_select's job and is unchanged; editing them goes through
--      updateUserProfile, which now checks the person works only in
--      companies the editor runs (lib/data/account-edit.ts).
--   3. The revoke function runs for the service role only, which is how
--      lib/actions/platform-admin.ts already calls it.
--
-- Safe as one paste and safe to run again.
begin;

revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (name, phone, estimate_funnel_order, dashboard_panel_order) on public.profiles to authenticated;

drop policy if exists "profiles_office_manage" on public.profiles;

revoke execute on function public.revoke_platform_admin_if_not_last(uuid) from public, anon, authenticated;
grant execute on function public.revoke_platform_admin_if_not_last(uuid) to service_role;

commit;
