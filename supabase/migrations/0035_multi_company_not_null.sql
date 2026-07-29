-- Multi-company support, step 3 of 4: enforce company_id + safety-net trigger.
--
-- Before making company_id required, add a BEFORE INSERT trigger that
-- fills it in from the inserting user's company_members row whenever an
-- insert doesn't set it explicitly. This matters because the app-layer
-- work that adds company_id to every insert (leads, activity_events,
-- etc. -- ~22 action files) hasn't shipped yet, and the app is live in
-- production right now. Without this trigger, the instant company_id
-- becomes NOT NULL below, every not-yet-updated insert path would start
-- failing for real users. With it, this migration is safe to run
-- immediately and the app-layer pass becomes an enhancement (explicit,
-- correct company_id) rather than a hard prerequisite.
--
-- Two fallbacks, tried in order:
--   1. auth.uid() -> company_members, for inserts made through the
--      normal session-scoped client (how most app code writes today).
--   2. If there's no session (service-role/admin client -- the leads
--      webhook, Meta leadgen, SMS webhook, and the no-show-followups
--      cron all write this way today with no user attached) AND there
--      is currently exactly one company, use that company. This keeps
--      those endpoints working exactly as they do today. It's
--      deliberately scoped to "exactly one company exists" rather than
--      "the first company" or similar -- once a second company exists,
--      an insert that still doesn't specify company_id has a genuinely
--      ambiguous target, and should fail loudly (NOT NULL violation)
--      rather than silently guessing wrong. Those service-role paths
--      need to be updated to pass company_id explicitly as part of the
--      app-layer pass, same as everything else -- this is a continuity
--      shim for the single-company period, not a permanent answer for
--      the multi-company case.
-- Safe to leave in place permanently: once every insert path sets
-- company_id itself, this trigger simply never has anything to fill in.
begin;

create function fill_company_id() returns trigger as $$
begin
  if new.company_id is null then
    select company_id into new.company_id
    from company_members
    where profile_id = auth.uid()
    limit 1;
  end if;

  if new.company_id is null and (select count(*) from companies) = 1 then
    select id into new.company_id from companies limit 1;
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

do $$
declare
  t text;
begin
  foreach t in array array[
    'leads', 'events', 'jobs', 'documents', 'contracts', 'lead_tasks', 'setter_contacts',
    'pipeline_stages', 'calendars', 'project_types', 'lead_sources',
    'call_dispositions', 'call_logs', 'dial_lists', 'role_page_visibility',
    'sms_quick_texts', 'sms_messages', 'activity_events', 'lead_notes', 'lead_files'
  ]
  loop
    execute format(
      'create trigger fill_company_id before insert on %I for each row execute function fill_company_id()',
      t
    );
    -- Catches any rows that drifted null between 0034's backfill and
    -- this migration running (activity_events in particular gets a
    -- constant stream of pageview/heartbeat inserts from live traffic).
    -- Safe while there's exactly one company, same reasoning as the
    -- trigger's fallback above.
    execute format(
      'update %I set company_id = (select id from companies limit 1) where company_id is null',
      t
    );
    execute format('alter table %I alter column company_id set not null', t);
  end loop;
end $$;

alter table company_profile alter column company_id set not null;
alter table company_profile add constraint company_profile_company_id_key unique (company_id);

alter table google_drive_connection alter column company_id set not null;
alter table google_drive_connection add constraint google_drive_connection_company_id_key unique (company_id);

commit;
