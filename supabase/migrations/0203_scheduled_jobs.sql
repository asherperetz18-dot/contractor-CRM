-- Scheduled jobs run from the database (DECISIONS #140).
--
-- The CRM's scheduled jobs (appointment and task reminders, no-show
-- follow-ups, rain alerts, calendar and phone syncs, the time clock)
-- used to be started by GitHub Actions on a timer. GitHub's timers run
-- late or not at all when GitHub is busy -- on 2026-10-05 it cancelled
-- runs for over an hour without starting them -- so a reminder could miss
-- its window for every company at once. From now on Supabase Cron starts them, on the minute, at the same
-- times as before (UTC). The jobs themselves don't change: the database
-- calls the same /api/cron routes GitHub did.
--
-- The database makes its own random token, keeps it in its vault and
-- sends it with each call; the CRM asks the database whether a token is
-- that one (crm_job_token_ok). Nobody has to copy a secret anywhere.
-- CRON_SECRET still works, for the "Run workflow" buttons on GitHub.
--
-- The nightly backup stays on GitHub: its encrypted file is kept there.
--
-- Run this right after merging the change that takes the timers off
-- GitHub, so the jobs aren't started twice. Safe to run twice.

begin;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- The token the scheduler sends. Made once; running this again keeps it.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'crm_job_token') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'crm_job_token',
      'Sent by Supabase Cron to the CRM''s /api/cron routes (DECISIONS #140)'
    );
  end if;
end
$$;

-- Whether a token is the scheduler's. Only the server (service role) may
-- ask; nobody signed in to the app can.
create or replace function public.crm_job_token_ok(token text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'crm_job_token' and decrypted_secret = token
  );
$$;
revoke all on function public.crm_job_token_ok(text) from public, anon, authenticated;
grant execute on function public.crm_job_token_ok(text) to service_role;

-- Starts one job: calls the CRM with the token. Kept in its own schema,
-- which the app's API doesn't expose, and only for /api/cron routes.
create schema if not exists crm_jobs;
revoke all on schema crm_jobs from public, anon, authenticated;

create or replace function crm_jobs.run(path text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  token text;
begin
  if path !~ '^/api/cron/[a-z0-9-]+(\?[a-z0-9=&]*)?$' then
    raise exception 'Not a CRM job: %', path;
  end if;
  select decrypted_secret into token from vault.decrypted_secrets where name = 'crm_job_token';
  if token is null then
    raise exception 'The crm_job_token is missing from the vault';
  end if;
  return net.http_post(
    url := 'https://crm.aibuildpros.com' || path,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || token),
    -- The routes may take up to five minutes; don't hang up on them.
    timeout_milliseconds := 300000
  );
end
$$;
revoke all on function crm_jobs.run(text) from public, anon, authenticated;

-- The same times GitHub used (UTC). Scheduling a name again updates it.
select cron.schedule('crm-appointment-reminders', '*/15 * * * *', $$select crm_jobs.run('/api/cron/appointment-reminders')$$);
select cron.schedule('crm-task-reminders', '*/15 * * * *', $$select crm_jobs.run('/api/cron/task-reminders')$$);
select cron.schedule('crm-no-show-followups', '*/15 * * * *', $$select crm_jobs.run('/api/cron/no-show-followups')$$);
select cron.schedule('crm-primecall-sync', '*/15 * * * *', $$select crm_jobs.run('/api/cron/primecall-sync')$$);
select cron.schedule('crm-google-calendar-sync', '7,22,37,52 * * * *', $$select crm_jobs.run('/api/cron/google-calendar-sync')$$);
select cron.schedule('crm-time-clock', '7 * * * *', $$select crm_jobs.run('/api/cron/time-clock')$$);
select cron.schedule('crm-ai-receptionist-finalize', '13 */2 * * *', $$select crm_jobs.run('/api/cron/ai-receptionist-finalize')$$);
select cron.schedule('crm-callrail-backfill', '40 */6 * * *', $$select crm_jobs.run('/api/cron/callrail-backfill?days=2')$$);
select cron.schedule('crm-rain-alerts', '0 6,14,22 * * *', $$select crm_jobs.run('/api/cron/rain-alerts')$$);

commit;

-- Check: should read 9.
select count(*) as scheduled_jobs_ready from cron.job where jobname like 'crm-%' and active;
