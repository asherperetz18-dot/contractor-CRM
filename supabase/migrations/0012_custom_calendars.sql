-- Custom calendars: admins can add/rename/recolor/delete/reorder
-- calendars instead of the fixed 4-value enum, matching the real
-- iBuildPro product's Admin Settings -> Calendars page. Also adds an
-- appointment outcome status (New/Confirmed/Showed/No-show/Cancelled),
-- separate from the existing customer_confirmed/rep_confirmed toggles.

-- events.event_type was a fixed enum; convert to text (same proven-safe
-- operation used for leads.stage and pipeline_stage).
alter table events alter column event_type drop default;
alter table events alter column event_type type text;
drop type event_type;
alter table events alter column event_type set default 'Estimate';

alter table events add column status text not null default 'New';

create table calendars (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color text not null default '#7C8798',
  sort_order int not null,
  is_system boolean not null default false,
  created_at timestamptz not null default now()
);

insert into calendars (name, color, sort_order) values
  ('Estimate', '#2D5F8A', 1),
  ('Job Visit', '#2F855A', 2),
  ('Meeting', '#C7691B', 3),
  ('Other', '#7C8798', 4);

alter table calendars enable row level security;

create policy "calendars_select" on calendars for select
  to authenticated using (true);
create policy "calendars_write" on calendars for all
  to authenticated using (has_role('Office') or has_role('Admin'))
  with check (has_role('Office') or has_role('Admin'));
