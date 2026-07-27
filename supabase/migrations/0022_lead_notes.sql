-- Timestamped activity/notes timeline for a lead, matching the real
-- iBuildPro product's Notes tab: multiple entries over time, each
-- optionally tagged to the appointment it came from, so an appointment's
-- outcome ("needs follow-up", "book 2nd appointment", etc.) gets logged
-- instead of the lead going cold after a Showed appointment. This is
-- additive alongside the existing single leads.notes field, which still
-- drives the Pipeline board's stale-notes warning.
create table lead_notes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads (id) on delete cascade,
  author_id uuid references profiles (id) on delete set null,
  body text not null,
  event_id uuid references events (id) on delete set null,
  created_at timestamptz not null default now()
);

create index lead_notes_lead_id_idx on lead_notes (lead_id);

alter table lead_notes enable row level security;

create policy "lead_notes_select" on lead_notes for select
  to authenticated using (true);
create policy "lead_notes_insert" on lead_notes for insert
  to authenticated with check (has_role('Office') or has_role('Sales') or has_role('Field'));
create policy "lead_notes_delete" on lead_notes for delete
  to authenticated using (has_role('Office') or has_role('Admin'));
