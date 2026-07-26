-- Pipeline v2 — expanded stages, lead assignment, note staleness, and a
-- follow-up tasks system to power the "Follow-ups Due" / "Cold Leads"
-- attention digest (matches the real iBuildPro product).
-- Safe to run once: leads table is empty at the time this was written, so
-- the pipeline_stage enum is dropped and recreated rather than migrated.

-- ============================================================
-- Expand pipeline_stage
-- ============================================================
alter table leads alter column stage drop default;
alter table leads alter column stage type text;
drop type pipeline_stage;

create type pipeline_stage as enum (
  'Unsorted',
  'New Lead',
  'Meta',
  'No Answer',
  'Contacted',
  'Appointment Scheduled',
  'Appointment Follow Up',
  '2nd Appointment',
  'Estimate Prepared',
  'Proposal Sent',
  'Pending Finance',
  'Close to Sale',
  'Won',
  'Lost',
  'DNC'
);

alter table leads alter column stage type pipeline_stage using stage::pipeline_stage;
alter table leads alter column stage set default 'Unsorted';

-- ============================================================
-- Lead assignment + note staleness tracking
-- ============================================================
alter table leads add column assigned_to uuid references profiles (id) on delete set null;
alter table leads add column notes_updated_at timestamptz;

create index leads_assigned_to_idx on leads (assigned_to);

-- Keep notes_updated_at in sync whenever notes actually change (used to
-- compute the "Stale Notes" warning -- notes untouched for 14+ days).
create function set_notes_updated_at() returns trigger as $$
begin
  if new.notes is distinct from old.notes then
    new.notes_updated_at = now();
  end if;
  return new;
end;
$$ language plpgsql;

create trigger leads_set_notes_updated_at before update on leads
  for each row execute function set_notes_updated_at();

-- ============================================================
-- Follow-up tasks (per lead)
-- ============================================================
create table lead_tasks (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads (id) on delete cascade,
  title text not null,
  due_date date not null,
  completed_at timestamptz,
  assigned_to uuid references profiles (id) on delete set null,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index lead_tasks_lead_id_idx on lead_tasks (lead_id);
create index lead_tasks_due_date_idx on lead_tasks (due_date);

alter table lead_tasks enable row level security;

create policy "lead_tasks_select" on lead_tasks for select
  to authenticated using (true);
create policy "lead_tasks_write" on lead_tasks for all
  to authenticated using (has_role('Office')) with check (has_role('Office'));
