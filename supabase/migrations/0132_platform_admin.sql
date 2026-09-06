-- A distinct concept from is_super_admin (0055), on purpose.
--
-- is_super_admin means "this identity is Admin in every company it
-- belongs to and can't be locked out" -- it protects one account inside
-- the companies that account is already a member of. It has never meant
-- anything about the platform itself, and nothing in the app has ever
-- checked it for that. That gap is what let the manual-invite feature
-- (send a setup link that creates a brand-new company, no payment)
-- ship gated on isAdminRole -- Office-or-Admin of whichever company you
-- happen to be viewing -- which means, unintentionally, that any paying
-- customer's own Office or Admin user can mint new tenants on the
-- platform today. That is a platform-operator action, not a
-- run-my-own-company one, and it needs its own permission.
--
-- is_platform_admin is that permission: global to the person (like
-- is_super_admin), independent of which company is currently selected.
-- It gates exactly two actions directly (see PlatformAdminGate and
-- lib/actions/platform-admin.ts), and one broader consequence that is
-- kept in sync by triggers further down rather than checked at read
-- time: holding it makes someone a real Office+Admin member of every
-- company on the platform, so they can open, use and administer any of
-- them the same way that company's own team does -- see the trigger
-- section below for why real membership rather than a bypass in RLS.
-- It does not imply is_super_admin and is_super_admin does not imply
-- it -- holding one says nothing about the other, in either direction.
--
-- Nobody starts with it, including existing super admins. There is no
-- in-app way to grant the very first one (every grant path itself
-- requires already being a platform admin), so bootstrapping is a
-- one-time hand-run SQL statement, the same way this project's own
-- migrations are applied -- see the README, and 0055's own precedent for
-- exactly this shape of problem:
--
--   update profiles set is_platform_admin = true where email = '<you>';
--
-- (lowercase the address -- profiles.email is stored lowercased, and
-- every lookup in this feature matches on that assumption.)
begin;

alter table profiles
  add column if not exists is_platform_admin boolean not null default false;

-- Who granted or revoked it, and when. This flag is rare and powerful
-- enough that "who did this" should have an answer that isn't "check
-- everyone's memory" -- unlike is_super_admin, which has never had an
-- in-app grant path at all and so never needed one.
create table platform_admin_audit (
  id uuid primary key default gen_random_uuid(),
  actor_profile_id uuid references profiles (id) on delete set null,
  target_profile_id uuid references profiles (id) on delete set null,
  action text not null check (action in ('grant', 'revoke')),
  created_at timestamptz not null default now()
);

create index platform_admin_audit_target_idx on platform_admin_audit (target_profile_id);

-- RLS on with no policies: reached only through the service-role client,
-- from lib/actions/platform-admin.ts, which does its own is_platform_admin
-- check before writing here at all -- the same shape as signup_invites
-- (0130) and portal_login_tokens before it.
alter table platform_admin_audit enable row level security;

-- "Would this leave zero Platform Admins" cannot be answered safely from
-- application code as a separate read-then-write: two people revoking
-- each other at the same instant would each read "someone else still
-- holds it" before either write commits, and both writes would then
-- succeed, leaving nobody. Application code also cannot hold a lock
-- across two separate calls to this API -- each one is its own
-- transaction under Supabase's connection pooling, exactly the reason
-- 0129's advisory lock is transaction-scoped rather than session-scoped.
-- So the whole check-and-revoke has to happen in one round trip, inside
-- one function, which is what this is.
--
-- One fixed lock key, not one per row: there is only ever one roster to
-- protect here, unlike 0129's per-(company, phone number) key.
--
-- Returns one of three outcomes rather than a bare boolean, because
-- "false" would otherwise conflate two very different things the caller
-- needs to tell apart: revoking someone who was never a Platform Admin
-- (nothing to do, not an error) and refusing to empty the roster (an
-- error the caller should show).
create or replace function public.revoke_platform_admin_if_not_last(p_target_id uuid)
returns text -- 'revoked' | 'refused_last' | 'not_admin'
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_target_is_admin boolean;
  v_other_count int;
begin
  perform pg_advisory_xact_lock(hashtext('platform_admin_roster'));

  select is_platform_admin into v_target_is_admin
    from profiles where id = p_target_id;

  if v_target_is_admin is distinct from true then
    return 'not_admin';
  end if;

  select count(*) into v_other_count
    from profiles
    where is_platform_admin = true and id <> p_target_id;

  if v_other_count = 0 then
    return 'refused_last';
  end if;

  update profiles set is_platform_admin = false where id = p_target_id;
  return 'revoked';
end;
$$;

-- ====================================================================
-- Real membership, everywhere, kept in sync by the database rather than
-- by application code -- so it applies no matter how is_platform_admin
-- changes: through grantPlatformAdmin/revokePlatformAdmin, or through
-- the hand-run bootstrap UPDATE above, which is application code's blind
-- spot (nothing in lib/actions/platform-admin.ts runs for a raw SQL
-- statement). A trigger fires either way.
--
-- Why real company_members rows rather than teaching every RLS policy
-- about this flag: the schema currently has ~124 policies across 51
-- tables, routed through at least ten different helper functions
-- (current_member_company_ids, current_role_company_ids,
-- current_lead_delete_company_ids, and others that re-implement the
-- same company_members lookup independently rather than composing on
-- top of a shared base) plus several policies with the check written
-- inline. Teaching all of them about a new bypass condition is a wide,
-- easy-to-get-wrong change -- missing one leaves access that works on
-- some screens and silently doesn't on others. A real row in
-- company_members needs none of that: every one of those ~124 policies
-- already grants Office/Admin access correctly, because that is
-- precisely what they were built and audited to do.
--
-- granted_via_platform_admin marks a row as existing FOR this reason,
-- not because someone was actually hired -- so it can be told apart from
-- a genuine membership two ways: hidden from that company's own team
-- (getCompanyMembers in lib/data/company.ts filters it out, which is
-- also what keeps a Platform Admin out of every "who's on my team"
-- picker, presence indicator and report the app builds from that same
-- roster), and removed cleanly on revoke without touching a real hire.
-- ====================================================================

alter table company_members
  add column if not exists granted_via_platform_admin boolean not null default false;

-- Fires when is_platform_admin flips either way on a profile.
-- Granting: a real Office+Admin row in every company that doesn't
-- already have one for this person -- ON CONFLICT DO NOTHING, so a
-- company they already genuinely belong to (their own, say) is left
-- exactly as it was. Revoking: removes only the rows this same
-- mechanism created, never a real membership.
create or replace function public.sync_platform_admin_company_memberships()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.is_platform_admin then
    insert into company_members (profile_id, company_id, roles, can_delete_leads, status, granted_via_platform_admin)
    select new.id, c.id, array['Office', 'Admin']::app_role[], true, 'Active', true
    from companies c
    on conflict (profile_id, company_id) do nothing;
  else
    delete from company_members
    where profile_id = new.id and granted_via_platform_admin = true;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_platform_admin_company_memberships_trigger on profiles;
create trigger sync_platform_admin_company_memberships_trigger
  after update of is_platform_admin on profiles
  for each row
  when (old.is_platform_admin is distinct from new.is_platform_admin)
  execute function public.sync_platform_admin_company_memberships();

-- The other half: a brand-new company needs every CURRENT Platform Admin
-- added to it too, not just future is_platform_admin changes catching
-- up to it. ON CONFLICT DO NOTHING here as well, for the case a Platform
-- Admin is themselves the one creating the company (createCompanyWithDefaults
-- in lib/signup/provision.ts inserts their real owner membership
-- separately, as an upsert that overwrites granted_via_platform_admin
-- back to false -- see the comment there for why the ordering between
-- that insert and this trigger must not matter).
create or replace function public.add_platform_admins_to_new_company()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into company_members (profile_id, company_id, roles, can_delete_leads, status, granted_via_platform_admin)
  select p.id, new.id, array['Office', 'Admin']::app_role[], true, 'Active', true
  from profiles p
  where p.is_platform_admin = true
  on conflict (profile_id, company_id) do nothing;
  return new;
end;
$$;

drop trigger if exists add_platform_admins_to_new_company_trigger on companies;
create trigger add_platform_admins_to_new_company_trigger
  after insert on companies
  for each row
  execute function public.add_platform_admins_to_new_company();

commit;
