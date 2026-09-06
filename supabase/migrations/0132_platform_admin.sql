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
-- is_super_admin), independent of which company is currently selected,
-- and checked nowhere else in the app except the platform-operator
-- actions that are actually about the platform (see PlatformAdminGate
-- and lib/actions/platform-admin.ts). It does not imply is_super_admin
-- and is_super_admin does not imply it -- holding one says nothing about
-- the other, in either direction.
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

commit;
