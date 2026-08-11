-- Which devices a person is actually signed in on.
--
-- auth.sessions cannot answer this. Tokens are refreshed server-side by
-- Next.js, so the user_agent Supabase records is "node" and the IP is a
-- Vercel address -- every session looks identical no matter whose phone
-- it is. The browser has to say who it is, so the identity is minted
-- client-side and stored here.
--
-- device_id lives in localStorage rather than sessionStorage: a tab is
-- not a device, and the app's existing activity session ids are per-tab,
-- which is why two tabs on one laptop already look like two sessions.
--
-- Run each step on its own. No begin/commit -- a failure inside a
-- transaction rolls the whole block back and the editor reports nothing.

-- ---------------------------------------------------------------- step 1
create table if not exists user_devices (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  -- Opaque id from the browser. Not a fingerprint: it identifies a
  -- browser profile, which is the closest honest proxy for "a device".
  device_id text not null,
  user_agent text,
  -- "iPhone · Safari", precomputed so the list is readable without
  -- parsing a user-agent string in five places.
  label text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- Set when an admin cuts a device off. The device signs itself out on
  -- its next ping, so this is the record and the trigger both.
  revoked_at timestamptz,
  revoked_by uuid references profiles(id),
  unique (profile_id, device_id)
);

-- ---------------------------------------------------------------- step 2
create index if not exists user_devices_company_seen_idx
  on user_devices (company_id, last_seen_at desc);

alter table user_devices enable row level security;

-- ---------------------------------------------------------------- step 3
-- Everyone may see and touch their own devices -- that is what the
-- heartbeat does, and a person should be able to see where they are
-- signed in. Office and Admin see the whole company, because they are the
-- ones who would revoke.
drop policy if exists "user_devices_select" on user_devices;
create policy "user_devices_select" on user_devices for select
  to authenticated using (
    profile_id = auth.uid()
    or has_role_in_company('Office', company_id)
  );

drop policy if exists "user_devices_insert" on user_devices;
create policy "user_devices_insert" on user_devices for insert
  to authenticated with check (profile_id = auth.uid());

-- Own row, or an Office/Admin revoking someone else's. Nobody may move a
-- device onto another person: with-check pins profile_id either way.
drop policy if exists "user_devices_update" on user_devices;
create policy "user_devices_update" on user_devices for update
  to authenticated using (
    profile_id = auth.uid()
    or has_role_in_company('Office', company_id)
  )
  with check (
    profile_id = auth.uid()
    or has_role_in_company('Office', company_id)
  );

-- ---------------------------------------------------------------- step 4
-- Proof rather than a success message. Expect three policies and the
-- table with its unique constraint.
select policyname, cmd from pg_policies
where schemaname = 'public' and tablename = 'user_devices'
order by policyname;
