-- Time clock, live location while on the clock, and job-site arrivals.
--
-- time_clock_settings  one row per company: who clocks in, zone size,
--                      overtime/late rules, how long trails are kept.
-- time_punches         one row per stretch of work. A shift with a
--                      break is two rows: the first ends with
--                      end_reason 'break', the second starts after it.
-- location_pings       where someone was, only while they have an open
--                      punch -- enforced here, not just by the app.
-- site_visits          arrived/left a job's zone. Written only by the
--                      server (service role) from the pings, so nobody
--                      can hand-craft their own attendance.
-- time_punch_changes   append-only audit of office edits to hours
--                      (payroll: see .claude/skills/change-tracking).
-- tracking_notices     who accepted the location notice, and when.
--
-- Workers may only punch "now": a clock-in or clock-out more than a
-- couple of minutes off the database clock is refused, and a worker
-- can close their own open punch but never rewrite one. Office/Admin
-- may correct any punch in their company; the server action records
-- each correction in time_punch_changes.
--
-- Idempotent; safe as one paste and safe to run twice.

begin;

create table if not exists time_clock_settings (
  company_id uuid primary key references companies (id) on delete cascade,
  tracked_roles app_role[] not null default array['Sales', 'Field', 'Production', 'Office']::app_role[],
  zone_radius_m int not null default 150 check (zone_radius_m between 30 and 1000),
  overtime_weekly_hours numeric not null default 40 check (overtime_weekly_hours > 0),
  late_after_min int not null default 10 check (late_after_min between 0 and 240),
  auto_clock_out_hours int not null default 12 check (auto_clock_out_hours between 1 and 24),
  trail_retention_days int not null default 90 check (trail_retention_days between 7 and 730),
  office_address text,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles (id) on delete set null
);

create table if not exists time_punches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  profile_id uuid not null references profiles (id) on delete cascade,
  clock_in timestamptz not null,
  clock_out timestamptz,
  end_reason text check (end_reason in ('clock_out', 'break', 'auto')),
  in_lat numeric,
  in_lng numeric,
  out_lat numeric,
  out_lng numeric,
  created_at timestamptz not null default now(),
  check (clock_out is null or clock_out >= clock_in)
);

create unique index if not exists time_punches_one_open
  on time_punches (company_id, profile_id) where clock_out is null;
create index if not exists time_punches_company_in_idx
  on time_punches (company_id, clock_in desc);

create table if not exists location_pings (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  profile_id uuid not null references profiles (id) on delete cascade,
  recorded_at timestamptz not null,
  lat numeric not null check (lat between -90 and 90),
  lng numeric not null check (lng between -180 and 180),
  accuracy_m numeric,
  created_at timestamptz not null default now()
);

create index if not exists location_pings_person_idx
  on location_pings (company_id, profile_id, recorded_at desc);
create index if not exists location_pings_company_idx
  on location_pings (company_id, recorded_at desc);

create table if not exists site_visits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  profile_id uuid not null references profiles (id) on delete cascade,
  event_id uuid references events (id) on delete set null,
  label text not null,
  arrived_at timestamptz not null,
  left_at timestamptz,
  distance_m int,
  created_at timestamptz not null default now()
);

create index if not exists site_visits_person_idx
  on site_visits (company_id, profile_id, arrived_at desc);
create unique index if not exists site_visits_one_open
  on site_visits (company_id, profile_id) where left_at is null;

create table if not exists time_punch_changes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  punch_id uuid not null references time_punches (id) on delete cascade,
  changed_by uuid references profiles (id) on delete set null,
  changed_at timestamptz not null default now(),
  reason text not null,
  old_punch jsonb not null,
  new_punch jsonb not null
);

create index if not exists time_punch_changes_punch_idx
  on time_punch_changes (punch_id, changed_at desc);

create table if not exists tracking_notices (
  company_id uuid not null references companies (id) on delete cascade,
  profile_id uuid not null references profiles (id) on delete cascade,
  accepted_at timestamptz not null default now(),
  primary key (company_id, profile_id)
);

-- ── RLS ────────────────────────────────────────────────────────────

alter table time_clock_settings enable row level security;
alter table time_punches enable row level security;
alter table location_pings enable row level security;
alter table site_visits enable row level security;
alter table time_punch_changes enable row level security;
alter table tracking_notices enable row level security;

-- Settings: everyone in the company reads them (the phone needs the
-- rules); only Office/Admin change them.
drop policy if exists "time_clock_settings_select" on time_clock_settings;
create policy "time_clock_settings_select" on time_clock_settings for select
  to authenticated using (is_member_of_company(company_id));
drop policy if exists "time_clock_settings_insert" on time_clock_settings;
create policy "time_clock_settings_insert" on time_clock_settings for insert
  to authenticated
  with check (has_role_in_company('Office', company_id) or has_role_in_company('Admin', company_id));
drop policy if exists "time_clock_settings_update" on time_clock_settings;
create policy "time_clock_settings_update" on time_clock_settings for update
  to authenticated
  using (has_role_in_company('Office', company_id) or has_role_in_company('Admin', company_id))
  with check (has_role_in_company('Office', company_id) or has_role_in_company('Admin', company_id));

-- Punches: your own, or everyone's if you're Office/Admin.
drop policy if exists "time_punches_select" on time_punches;
create policy "time_punches_select" on time_punches for select
  to authenticated
  using (
    (profile_id = auth.uid() and is_member_of_company(company_id))
    or has_role_in_company('Office', company_id)
    or has_role_in_company('Admin', company_id)
  );

-- A worker clocks themselves in, now. Office/Admin may add a missed
-- punch for anyone (the action audits it).
drop policy if exists "time_punches_insert" on time_punches;
create policy "time_punches_insert" on time_punches for insert
  to authenticated
  with check (
    (
      profile_id = auth.uid()
      and is_member_of_company(company_id)
      and clock_out is null
      and clock_in between now() - interval '2 minutes' and now() + interval '1 minute'
    )
    or has_role_in_company('Office', company_id)
    or has_role_in_company('Admin', company_id)
  );

drop policy if exists "time_punches_update" on time_punches;
create policy "time_punches_update" on time_punches for update
  to authenticated
  using (
    (profile_id = auth.uid() and is_member_of_company(company_id))
    or has_role_in_company('Office', company_id)
    or has_role_in_company('Admin', company_id)
  )
  with check (
    (profile_id = auth.uid() and is_member_of_company(company_id))
    or has_role_in_company('Office', company_id)
    or has_role_in_company('Admin', company_id)
  );
-- No delete policy: a punch is corrected, never erased.

-- What a policy can't see is the OLD row, so the "a worker may only
-- close their own open punch, now" rule lives in a trigger. The
-- service role (cron auto clock-out) has no auth.uid() and passes.
create or replace function time_punches_guard() returns trigger as $$
begin
  if auth.uid() is null
     or has_role_in_company('Office', old.company_id)
     or has_role_in_company('Admin', old.company_id) then
    return new;
  end if;
  if old.clock_out is not null then
    raise exception 'This punch is closed; ask the office to correct it.';
  end if;
  if new.clock_in <> old.clock_in
     or new.profile_id <> old.profile_id
     or new.company_id <> old.company_id then
    raise exception 'Only the office can change a clock-in time.';
  end if;
  if new.clock_out is null
     or new.clock_out not between now() - interval '2 minutes' and now() + interval '1 minute'
     or new.end_reason not in ('clock_out', 'break') then
    raise exception 'A clock-out must be now.';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists time_punches_guard on time_punches;
create trigger time_punches_guard before update on time_punches
  for each row execute function time_punches_guard();

-- Pings: only your own, only while you're on the clock, only recent
-- (a phone that was offline may send a short backlog).
drop policy if exists "location_pings_select" on location_pings;
create policy "location_pings_select" on location_pings for select
  to authenticated
  using (
    (profile_id = auth.uid() and is_member_of_company(company_id))
    or has_role_in_company('Office', company_id)
    or has_role_in_company('Admin', company_id)
  );
drop policy if exists "location_pings_insert" on location_pings;
create policy "location_pings_insert" on location_pings for insert
  to authenticated
  with check (
    profile_id = auth.uid()
    and recorded_at between now() - interval '15 minutes' and now() + interval '1 minute'
    and exists (
      select 1 from public.time_punches p
      where p.company_id = location_pings.company_id
        and p.profile_id = auth.uid()
        and p.clock_out is null
    )
  );
-- No update/delete: the cron purges old trails with the service role.

-- Visits: read your own or everyone's (Office/Admin). No write policy:
-- only the server writes them.
drop policy if exists "site_visits_select" on site_visits;
create policy "site_visits_select" on site_visits for select
  to authenticated
  using (
    (profile_id = auth.uid() and is_member_of_company(company_id))
    or has_role_in_company('Office', company_id)
    or has_role_in_company('Admin', company_id)
  );

-- Audit: Office/Admin read and append, attributed to themselves.
-- No update or delete for anyone.
drop policy if exists "time_punch_changes_select" on time_punch_changes;
create policy "time_punch_changes_select" on time_punch_changes for select
  to authenticated
  using (has_role_in_company('Office', company_id) or has_role_in_company('Admin', company_id));
drop policy if exists "time_punch_changes_insert" on time_punch_changes;
create policy "time_punch_changes_insert" on time_punch_changes for insert
  to authenticated
  with check (
    changed_by = auth.uid()
    and (has_role_in_company('Office', company_id) or has_role_in_company('Admin', company_id))
  );

drop policy if exists "tracking_notices_select" on tracking_notices;
create policy "tracking_notices_select" on tracking_notices for select
  to authenticated
  using (
    (profile_id = auth.uid() and is_member_of_company(company_id))
    or has_role_in_company('Office', company_id)
    or has_role_in_company('Admin', company_id)
  );
drop policy if exists "tracking_notices_insert" on tracking_notices;
create policy "tracking_notices_insert" on tracking_notices for insert
  to authenticated
  with check (profile_id = auth.uid() and is_member_of_company(company_id));

commit;

-- Verify: six tables, RLS on for each.
select relname, relrowsecurity as rls_enabled
from pg_class
where relname in ('time_clock_settings', 'time_punches', 'location_pings',
                  'site_visits', 'time_punch_changes', 'tracking_notices')
order by relname;
