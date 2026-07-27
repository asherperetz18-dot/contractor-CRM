-- Saved call lists (Power Dialer "SAVED LISTS" panel: Save as list / Upload
-- CSV) and a single global call script shown during a dialing session.
create table dial_lists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  lead_ids uuid[] not null default '{}',
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table dial_lists enable row level security;

create policy "dial_lists_select" on dial_lists for select
  to authenticated using (true);
create policy "dial_lists_insert" on dial_lists for insert
  to authenticated with check (true);
create policy "dial_lists_delete" on dial_lists for delete
  to authenticated using (true);

alter table company_profile add column call_script text;
