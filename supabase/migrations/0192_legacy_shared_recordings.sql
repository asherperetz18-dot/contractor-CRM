-- Old call recordings keep playing after a company moved to its own Twilio
-- (DECISIONS #113).
--
-- Before every company had its own Twilio account, companies without one
-- borrowed the shared account (the server's TWILIO_* settings -- La Home
-- Contractor's), and their calls were recorded THERE. Since #104 a
-- recording is fetched with the company's own account only, so those
-- older recordings stopped playing: "No recording." for a company with
-- its own account now, a failure for one with none.
--
-- The recording player may fetch them with the shared account again, but
-- only the ones listed here, once. call_logs is writable by a company's
-- own members, so a recording link alone can't be trusted: a row edited to
-- point at La Home's own recording would otherwise be fetched with La
-- Home's credentials. This list is written by this migration alone. RLS is
-- on with no policies, and anon/authenticated have no rights on it, so no
-- CRM user can read or add to it. Only the server (service role) reads it.
--
-- Listed: every call whose saved Twilio recording sits on an account other
-- than the one its company has saved now (or the company has none).
-- Recordings on a company's own account are not listed and don't need to
-- be. Safe to run twice.

create table if not exists public.legacy_shared_recordings (
  call_log_id uuid primary key references public.call_logs(id) on delete cascade,
  recording_url text not null,
  listed_at timestamptz not null default now()
);

alter table public.legacy_shared_recordings enable row level security;
revoke all on public.legacy_shared_recordings from anon, authenticated;

insert into public.legacy_shared_recordings (call_log_id, recording_url)
select c.id, c.recording_url
from public.call_logs c
left join public.company_profile p on p.company_id = c.company_id
where c.recording_url ~ '^https://api(\.[a-z0-9-]+\.[a-z0-9-]+)?\.twilio\.com/2010-04-01/Accounts/AC[0-9a-fA-F]{32}/Recordings/RE[0-9a-fA-F]{32}'
  and (
    p.twilio_account_sid is null
    or position('/Accounts/' || p.twilio_account_sid || '/' in c.recording_url) = 0
  )
on conflict (call_log_id) do nothing;

-- How many old recordings were listed, per company: one row each.
select co.name as company, count(*) as old_recordings_listed
from public.legacy_shared_recordings l
join public.call_logs c on c.id = l.call_log_id
join public.companies co on co.id = c.company_id
group by co.name
order by 2 desc;
