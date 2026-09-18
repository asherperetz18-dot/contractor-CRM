-- AI receptionist: the AI answers a call nobody could pick up, takes
-- the caller's details, and files the lead.
--
-- Two per-company switches on company_profile (off by default -- no
-- company's phone behavior changes the day this runs), and one working
-- table holding each answered call's conversation while it is live and
-- its outcome after: the webhook turns append to `turns`, and the
-- finalize pass (goodbye webhook, inbound-call sweep, or the cron
-- floor) creates/matches the lead, writes the note, and closes the row.
--
-- The code ships dark before this runs: every read of these columns is
-- tolerant, and a missing table simply leaves callers on today's
-- voicemail path.
--
-- Idempotent; safe as one paste and safe to run twice.

begin;

alter table company_profile
  add column if not exists ai_receptionist_enabled boolean not null default false;

alter table company_profile
  add column if not exists ai_receptionist_greeting text;

create table if not exists ai_receptionist_calls (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  call_sid text not null unique,
  from_number text not null default '',
  to_number text not null default '',
  -- The conversation so far: [{"role":"caller"|"assistant","text":"..."}]
  turns jsonb not null default '[]'::jsonb,
  -- Consecutive empty Gather results; two in a row ends the call.
  silent_turns integer not null default 0,
  -- active -> done (goodbye said) -> finalizing -> finalized
  status text not null default 'active',
  lead_id uuid references leads(id) on delete set null,
  summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_receptionist_calls_company_idx
  on ai_receptionist_calls (company_id, created_at desc);

create index if not exists ai_receptionist_calls_open_idx
  on ai_receptionist_calls (status, updated_at)
  where status in ('active', 'done');

alter table ai_receptionist_calls enable row level security;

-- Webhooks write through the service role (they have no user session);
-- company members may read their own company's calls. No insert/update
-- policies on purpose: nothing in the app edits these rows by hand.
drop policy if exists "ai_receptionist_calls_select" on ai_receptionist_calls;
create policy "ai_receptionist_calls_select" on ai_receptionist_calls for select
  to authenticated
  using (
    exists (
      select 1 from public.company_members m
      where m.profile_id = auth.uid()
        and m.company_id = ai_receptionist_calls.company_id
        and m.status = 'Active'
    )
  );

commit;
