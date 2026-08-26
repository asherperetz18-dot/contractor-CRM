begin;

-- Checklist templates: a named list of steps the company reuses per
-- project ("Kitchen close-out", "Pre-drywall inspection"). Items are a
-- jsonb array of strings on the template row -- templates are copied
-- into projects, never referenced live, so editing one later must not
-- rewrite running jobs.
create table checklist_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  name text not null,
  items jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table checklist_templates enable row level security;

create policy "checklist_templates_select" on checklist_templates for select
  to authenticated using (is_member_of_company(company_id));
create policy "checklist_templates_write" on checklist_templates for all
  to authenticated
  using (
    has_role_in_company('Office', company_id) or has_role_in_company('Admin', company_id)
  )
  with check (
    has_role_in_company('Office', company_id) or has_role_in_company('Admin', company_id)
  );

-- The live checklist on one project. Anchored to the signed contract
-- (which is what the Projects page calls a project); items die with it.
create table project_checklist_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  estimate_id uuid not null references estimates (id) on delete cascade,
  label text not null,
  sort_order int not null default 0,
  completed_at timestamptz,
  completed_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index project_checklist_items_estimate_idx
  on project_checklist_items (estimate_id, sort_order);

alter table project_checklist_items enable row level security;

create policy "project_checklist_items_select" on project_checklist_items for select
  to authenticated using (is_member_of_company(company_id));
-- Checking an item off is logging work that happened: any member can.
-- Changing the list itself (adding, removing) is Office/Admin.
create policy "project_checklist_items_update" on project_checklist_items for update
  to authenticated
  using (is_member_of_company(company_id))
  with check (is_member_of_company(company_id));
create policy "project_checklist_items_insert" on project_checklist_items for insert
  to authenticated
  with check (
    has_role_in_company('Office', company_id) or has_role_in_company('Admin', company_id)
  );
create policy "project_checklist_items_delete" on project_checklist_items for delete
  to authenticated
  using (
    has_role_in_company('Office', company_id) or has_role_in_company('Admin', company_id)
  );

commit;
