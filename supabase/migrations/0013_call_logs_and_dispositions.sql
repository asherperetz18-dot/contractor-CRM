-- Foundation for the Power Dialer: admin-managed call dispositions
-- (mirrors Pipeline Stages / Calendars) and a call log capturing every
-- in-app call (duration, recording, disposition), matching the real
-- iBuildPro product's Call Reports page.

create table call_dispositions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color text not null default '#7C8798',
  sort_order int not null,
  is_system boolean not null default false,
  created_at timestamptz not null default now()
);

-- Matches the exact disposition list on the real iBuildPro Power Dialer
-- (verified by browsing crm.ibuildpro.co/dial-queue). "No Disposition" is
-- the default state for a fresh call log row; "Any Disposition" is a
-- filter-only concept (has some disposition set) with no stored row.
insert into call_dispositions (name, color, sort_order, is_system) values
  ('No Disposition', '#9A9384', 1, true),
  ('Connected', '#2D5F8A', 2, false),
  ('Sale / Won', '#2F855A', 3, false),
  ('Callback', '#C7691B', 4, false),
  ('Appointment Set', '#6B4FA0', 5, false),
  ('Left Voicemail', '#4A90A4', 6, false),
  ('No Answer', '#B7862B', 7, false),
  ('Not Interested', '#C0392B', 8, false),
  ('Wrong Number', '#7C8798', 9, false),
  ('Other', '#9A9384', 10, false);

alter table call_dispositions enable row level security;

create policy "call_dispositions_select" on call_dispositions for select
  to authenticated using (true);
create policy "call_dispositions_write" on call_dispositions for all
  to authenticated using (has_role('Office') or has_role('Admin'))
  with check (has_role('Office') or has_role('Admin'));

create table call_logs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads (id) on delete set null,
  rep_id uuid references profiles (id) on delete set null,
  direction text not null default 'outbound',
  from_number text not null,
  to_number text not null,
  status text not null default 'completed',
  duration_seconds int not null default 0,
  disposition text not null default 'No Disposition',
  recording_url text,
  twilio_call_sid text,
  notes text,
  created_at timestamptz not null default now()
);

create index call_logs_created_at_idx on call_logs (created_at);
create index call_logs_lead_id_idx on call_logs (lead_id);
create index call_logs_rep_id_idx on call_logs (rep_id);
create index call_logs_twilio_call_sid_idx on call_logs (twilio_call_sid);

alter table call_logs enable row level security;

create policy "call_logs_select" on call_logs for select
  to authenticated using (true);
create policy "call_logs_insert" on call_logs for insert
  to authenticated with check (true);
create policy "call_logs_update" on call_logs for update
  to authenticated using (true) with check (true);
