begin;

-- Who opened which lead, and when. Opening a lead is a modal rather than
-- a route, so activity_events (which only records page paths) never saw
-- it -- this is the only record of it.
create table lead_views (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  opened_at timestamptz not null default now()
);

-- The card and the modal both ask "who opened this lead recently", which
-- is this index exactly.
create index lead_views_lead_idx on lead_views (lead_id, opened_at desc);
create index lead_views_company_idx on lead_views (company_id, opened_at desc);

alter table lead_views enable row level security;

-- Anyone in the company may record that they opened a lead: the write has
-- to happen for whoever is looking, and the row is stamped with their own
-- id by the server action.
create policy "members can record a view"
  on lead_views for insert
  with check (
    exists (
      select 1 from company_members m
      where m.profile_id = auth.uid()
        and m.company_id = lead_views.company_id
        and m.status = 'Active'
    )
  );

-- Reading the trail is a management view, so it needs the Admin role
-- itself rather than Office-or-Admin.
create policy "admins can read the trail"
  on lead_views for select
  using (has_role_in_company('Admin', company_id));

commit;
