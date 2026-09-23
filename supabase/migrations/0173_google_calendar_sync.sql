-- Google Calendar sync, two-way.
--
-- A connection is one Google account the CRM may write to and read
-- from: a rep's own (profile_id set -- their appointments land on their
-- own calendar) or the company's (profile_id null -- every appointment,
-- connected by an Office/Admin). Tokens live here the same way Google
-- Drive's do (0027): RLS on with no policies, so only the service role
-- can read them, and the pages that show "connected as" go through a
-- server action.
--
-- A link is one appointment's copy on one connection. It carries what
-- the sync needs to tell "our own write echoing back" (google_etag)
-- from "someone moved it in Google", and "changed since we last pushed"
-- (crm_updated_at). event_id is deliberately NOT a foreign key: the
-- appointment is hard-deleted by the calendar (deleteEvent), and the
-- link has to outlive it so the next run can take the Google copy down.
--
-- Safe to run twice. The settings page shows "not set up" and the cron
-- does nothing until this exists.
begin;

create table if not exists google_calendar_connections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  profile_id uuid references profiles (id) on delete cascade,
  google_email text,
  google_calendar_id text not null default 'primary',
  access_token text,
  refresh_token text not null,
  token_expires_at timestamptz,
  -- Google's incremental cursor for events.list; null forces a full read.
  sync_token text,
  last_synced_at timestamptz,
  last_error text,
  connected_at timestamptz not null default now()
);

-- One connection per rep per company, and one company-wide one.
create unique index if not exists google_calendar_connections_rep_idx
  on google_calendar_connections (company_id, profile_id) where profile_id is not null;
create unique index if not exists google_calendar_connections_company_idx
  on google_calendar_connections (company_id) where profile_id is null;

alter table google_calendar_connections enable row level security;

create table if not exists google_calendar_links (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references google_calendar_connections (id) on delete cascade,
  event_id uuid not null,
  google_event_id text not null,
  google_etag text,
  crm_updated_at timestamptz,
  google_updated timestamptz,
  synced_at timestamptz not null default now(),
  unique (connection_id, event_id),
  unique (connection_id, google_event_id)
);

create index if not exists google_calendar_links_event_idx on google_calendar_links (event_id);

alter table google_calendar_links enable row level security;

commit;
