-- Contract templates.
--
-- A contract is not settings: it is the document the customer signs, and
-- it has to be frozen at the moment they sign it. That already happens --
-- estimates.terms is copied from company_profile.estimate_terms when an
-- estimate is created, so editing the template next year cannot rewrite
-- a contract signed last year. This keeps that and replaces the single
-- untitled blob with named templates, because a roof and an ADU do not
-- share a scope.
--
-- Run each step on its own. No begin/commit -- a failure inside a
-- transaction rolls the whole block back and the editor reports nothing.

-- ---------------------------------------------------------------- step 1
create table if not exists contract_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  -- Plain text as pasted from Word, with {{token}} merge fields. Not
  -- HTML: this is rendered into a customer-facing document, and a
  -- template that can carry markup is a template that can carry a script.
  body text not null default '',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);

-- ---------------------------------------------------------------- step 2
-- One default per company, enforced by the database rather than by
-- remembering to clear the old one. A partial index is what makes
-- "only where true" possible.
create unique index if not exists contract_templates_one_default
  on contract_templates (company_id) where is_default;

-- Which template a contract came from. The text itself still lives on
-- estimates.terms, frozen; this is only provenance.
alter table estimates add column if not exists contract_template_id uuid
  references contract_templates(id) on delete set null;

-- ---------------------------------------------------------------- step 3
alter table contract_templates enable row level security;

-- Anyone in the company may read one: creating an estimate has to.
drop policy if exists "contract_templates_select" on contract_templates;
create policy "contract_templates_select" on contract_templates for select
  to authenticated using (
    exists (
      select 1 from company_members m
      where m.profile_id = auth.uid()
        and m.company_id = contract_templates.company_id
        and m.status = 'Active'
    )
  );

-- Writing one is Office/Admin. This is the legal text every customer
-- signs; it is not something a rep should be editing between visits.
drop policy if exists "contract_templates_write" on contract_templates;
create policy "contract_templates_write" on contract_templates for all
  to authenticated
  using (has_role_in_company('Office', company_id))
  with check (has_role_in_company('Office', company_id));

-- ---------------------------------------------------------------- step 4
-- Proof rather than a success message.
select policyname, cmd from pg_policies
where schemaname = 'public' and tablename = 'contract_templates'
order by policyname;
