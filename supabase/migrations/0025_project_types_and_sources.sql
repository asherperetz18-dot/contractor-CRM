-- Admin-managed picklists for a lead's Project Type and Source, matching
-- the existing Pipeline Stages / Calendars pattern (Settings page, drag
-- to reorder, rename, delete). Seeded from values already in real use
-- across leads so the picklist starts useful, not empty.
create table project_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null,
  created_at timestamptz not null default now()
);

create table lead_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null,
  created_at timestamptz not null default now()
);

insert into project_types (name, sort_order) values
  ('Exterior finishing', 1),
  ('Commercial projects', 2),
  ('Home building', 3),
  ('Home remodel and renovation', 4),
  ('Accessory buildings', 5),
  ('ADU', 6),
  ('Kitchen Remodel', 7),
  ('Kitchen Cabinets', 8),
  ('Bathroom Remodel', 9),
  ('Install Shower', 10),
  ('Install Bathtub', 11),
  ('Install Bidet', 12),
  ('Decks and patio', 13),
  ('Home addition', 14),
  ('Roofing', 15),
  ('Basement waterproofing', 16),
  ('Crawl space foundation', 17),
  ('Foundation drainage', 18),
  ('Foundations and concrete', 19),
  ('Interior finishing', 20);

insert into lead_sources (name, sort_order) values
  ('Referral', 1),
  ('Website', 2),
  ('CA Pro Guarantee', 3),
  ('Facebook', 4),
  ('Google', 5),
  ('Repeat Customer', 6),
  ('Cold Call', 7),
  ('CSV Import', 8),
  ('Other', 9);

alter table project_types enable row level security;
alter table lead_sources enable row level security;

create policy "project_types_select" on project_types for select
  to authenticated using (true);
create policy "project_types_write" on project_types for all
  to authenticated using (has_role('Office') or has_role('Admin'))
  with check (has_role('Office') or has_role('Admin'));

create policy "lead_sources_select" on lead_sources for select
  to authenticated using (true);
create policy "lead_sources_write" on lead_sources for all
  to authenticated using (has_role('Office') or has_role('Admin'))
  with check (has_role('Office') or has_role('Admin'));
