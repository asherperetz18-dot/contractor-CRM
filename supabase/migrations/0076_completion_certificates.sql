-- Completion certificates.
--
-- The document a homeowner signs to say the work is done and accepted.
-- It starts the warranty clock, evidences acceptance, and is what makes
-- the final payment defensible if the work is disputed later.
--
-- Deliberately not a "Notice of Completion" -- that is a different
-- instrument, recorded with the county by the owner under Civil Code
-- 8182. This is the private acceptance between contractor and client.
--
-- Built as a third estimate kind for the same reason change orders were:
-- it is a document that gets sent, viewed and signed, and all of that
-- exists. It simply carries no money.
--
-- Run each step on its own. No begin/commit.

-- ---------------------------------------------------------------- step 1
-- Snags. Almost no job is accepted with none, and without somewhere to
-- record them the customer either refuses to sign or signs away a
-- complaint they meant to keep -- so the certificate has to hold them
-- rather than pretend they do not exist.
alter table estimates add column if not exists completion_notes text;

-- The day the work was actually finished, which is not always the day
-- somebody got round to signing. The warranty runs from this.
alter table estimates add column if not exists completed_on date;

-- ---------------------------------------------------------------- step 2
-- Contract templates gain a kind too, so the certificate's wording is
-- edited in the same place as the contract rather than living in code.
alter table contract_templates add column if not exists kind text not null default 'contract';

-- One default per company PER KIND. The old index allowed a single
-- default overall, which a completion certificate would have fought the
-- contract for.
drop index if exists contract_templates_one_default;
create unique index if not exists contract_templates_one_default
  on contract_templates (company_id, kind) where is_default;

-- ---------------------------------------------------------------- step 3
-- Proof rather than a success message.
select
  (select count(*) from information_schema.columns
    where table_name = 'estimates'
      and column_name in ('completion_notes', 'completed_on')) as estimate_cols,
  (select count(*) from information_schema.columns
    where table_name = 'contract_templates' and column_name = 'kind') as template_kind,
  (select count(*) from pg_indexes
    where indexname = 'contract_templates_one_default') as default_index;
