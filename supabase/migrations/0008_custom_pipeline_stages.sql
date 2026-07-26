-- Custom pipeline stages: admins can reorder, rename, add, and delete
-- stages instead of the fixed enum. Mirrors the real iBuildPro product's
-- Admin Settings -> Pipeline Stages page.

-- leads.stage was already converted enum -> text once before (see
-- 0002_pipeline_v2.sql), so this is a proven, safe operation.
alter table leads alter column stage drop default;
alter table leads alter column stage type text;
drop type pipeline_stage;
alter table leads alter column stage set default 'Unsorted';

create table pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color text not null default '#7C8798',
  sort_order int not null,
  is_system boolean not null default false,
  created_at timestamptz not null default now()
);

-- Seed with the current stage list/order/colors so the board looks
-- identical after this migration runs. Unsorted, Appointment Scheduled,
-- Won, and Lost are marked system because app logic (auto-advance on
-- booking, pipeline value/won stats) depends on those exact names.
insert into pipeline_stages (name, color, sort_order, is_system) values
  ('Unsorted', '#9A9384', 1, true),
  ('New Lead', '#7C8798', 2, false),
  ('Meta', '#7C8798', 3, false),
  ('No Answer', '#B7862B', 4, false),
  ('Contacted', '#2D5F8A', 5, false),
  ('Appointment Scheduled', '#C7691B', 6, true),
  ('Appointment Follow Up', '#C7691B', 7, false),
  ('2nd Appointment', '#C7691B', 8, false),
  ('Estimate Prepared', '#2D5F8A', 9, false),
  ('Proposal Sent', '#2D5F8A', 10, false),
  ('Pending Finance', '#B7862B', 11, false),
  ('Close to Sale', '#B7862B', 12, false),
  ('Won', '#2F855A', 13, true),
  ('Lost', '#C0392B', 14, true),
  ('DNC', '#C0392B', 15, false);

alter table pipeline_stages enable row level security;

create policy "pipeline_stages_select" on pipeline_stages for select
  to authenticated using (true);
create policy "pipeline_stages_write" on pipeline_stages for all
  to authenticated using (has_role('Office') or has_role('Admin'))
  with check (has_role('Office') or has_role('Admin'));
