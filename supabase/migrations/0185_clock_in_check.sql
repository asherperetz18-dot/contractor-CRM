-- Where a clock-in happened, checked against the person's places today
-- (their appointments, the production jobs they're on, the office).
--
-- time_clock_settings  clock_in_check: 'off' | 'record' (flag on
--                      Timesheets) | 'ask' (flag, and ask the worker
--                      why when they clock in away from every place).
--                      check_roles: whose clock-ins are checked.
-- time_punches         the verdict for each clock-in and clock-out,
--                      plus the worker's reason. Written only by the
--                      server, from the phone's location -- a worker
--                      can't stamp their own punch "at the job".
-- site_visits          job_id, for arrivals at a production job with no
--                      appointment that day (a crew on day 3 of a job).
--
-- Existing punches take 'not_required' (the default), so weeks from
-- before this check don't light up with flags. A worker's own insert
-- has the verdict cleared by the trigger below; one made by going
-- around the app therefore stays blank and shows as "Not checked".
--
-- Needs 0174_time_clock.sql. Idempotent; safe as one paste and safe to
-- run twice.

begin;

alter table time_clock_settings
  add column if not exists clock_in_check text not null default 'ask'
    check (clock_in_check in ('off', 'record', 'ask')),
  add column if not exists check_roles app_role[] not null
    default array['Field', 'Production']::app_role[];

alter table time_punches
  add column if not exists in_check text default 'not_required'
    check (in_check in ('at_place', 'away', 'no_location', 'no_places', 'not_required')),
  add column if not exists in_place text,
  add column if not exists in_distance_m int,
  add column if not exists in_reason text check (char_length(in_reason) <= 300),
  add column if not exists out_check text default 'not_required'
    check (out_check in ('at_place', 'away', 'no_location', 'no_places', 'not_required')),
  add column if not exists out_place text,
  add column if not exists out_distance_m int;

alter table site_visits
  add column if not exists job_id uuid references jobs (id) on delete set null;

-- Workers may insert and close their own punch (0174), so the verdict
-- needs its own guard: on a worker's insert it's cleared, on a worker's
-- update it's kept as it was. The server action writes it with the
-- service role (no auth.uid()), which passes, as do Office and Admin,
-- who may already correct any punch.
create or replace function time_punches_stamp_guard() returns trigger as $$
begin
  if auth.uid() is null
     or has_role_in_company('Office', new.company_id)
     or has_role_in_company('Admin', new.company_id) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.in_check := null;
    new.in_place := null;
    new.in_distance_m := null;
    new.in_reason := null;
    new.out_check := null;
    new.out_place := null;
    new.out_distance_m := null;
  else
    new.in_check := old.in_check;
    new.in_place := old.in_place;
    new.in_distance_m := old.in_distance_m;
    new.in_reason := old.in_reason;
    new.out_check := old.out_check;
    new.out_place := old.out_place;
    new.out_distance_m := old.out_distance_m;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists time_punches_stamp_guard on time_punches;
create trigger time_punches_stamp_guard before insert or update on time_punches
  for each row execute function time_punches_stamp_guard();

commit;

-- Verify: the new columns exist (expect 10 rows).
select table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'time_clock_settings' and column_name in ('clock_in_check', 'check_roles'))
    or (table_name = 'time_punches' and column_name in ('in_check', 'in_place', 'in_distance_m', 'in_reason',
                                                       'out_check', 'out_place', 'out_distance_m'))
    or (table_name = 'site_visits' and column_name = 'job_id')
  )
order by table_name, column_name;
