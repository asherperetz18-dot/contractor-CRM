-- Client Portal: lets a customer sign in and see their own project --
-- appointments, status, photos, and messages -- without touching staff
-- auth. Clients deliberately do NOT get Supabase Auth accounts: a trigger
-- creates a `profiles` row for every auth user, so signing clients up that
-- way would drop every customer into the staff/reps lists. Instead the
-- portal runs on its own short-lived magic-link tokens and session rows,
-- both readable only by the service role (RLS on, no policies).

begin;

-- Single-use magic-link tokens. Only the sha256 hash is stored, so a leak
-- of this table can't be replayed to log in as a customer.
create table portal_login_tokens (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads (id) on delete cascade,
  company_id uuid not null references companies (id),
  token_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index portal_login_tokens_lead_id_idx on portal_login_tokens (lead_id);

-- Logged-in portal sessions, keyed by an httpOnly cookie. Same hash-only
-- storage as the login tokens above.
create table portal_sessions (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads (id) on delete cascade,
  company_id uuid not null references companies (id),
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index portal_sessions_lead_id_idx on portal_sessions (lead_id);

-- RLS on with no policies at all: the authenticated (staff) client can
-- never read these, and the portal's server code reaches them through the
-- service-role client only.
alter table portal_login_tokens enable row level security;
alter table portal_sessions enable row level security;

-- Messages a client writes in the portal land in the same thread the team
-- already works out of (Reply Inbox / Text Reports), so nothing new has to
-- be monitored. This column just records how the message arrived.
alter table sms_messages add column channel text not null default 'sms';

commit;
