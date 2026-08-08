begin;

-- Saved scopes of work, used as worked examples for the AI generator.
--
-- This is how the estimator actually gets better: not by training a model
-- but by showing it two or three scopes this contractor has really
-- written, so it copies their structure, depth and vocabulary. Examples
-- beat instructions for teaching shape -- "group by phase" is a rule the
-- model can follow badly, a real scope is a target it can match.
create table scope_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,

  name text not null,
  -- Matches leads.project_type. Null means "use for any job", which is
  -- the sensible default for a house-standard scope like site protection.
  project_type text,
  body text not null default '',

  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index scope_templates_company_idx on scope_templates (company_id, project_type);

alter table scope_templates enable row level security;

-- Same audience as estimates: if you can read an estimate you can read
-- the library it draws on, and if you can write one you can add to it.
create policy "scope_templates_select" on scope_templates for select
  to authenticated using (
    is_member_of_company(company_id) and can_view_estimates_in_company(company_id)
  );

create policy "scope_templates_write" on scope_templates for all
  to authenticated using (can_create_estimates_in_company(company_id))
  with check (can_create_estimates_in_company(company_id));

commit;
