-- Company Tax ID on the Company Profile page. The profile carries the
-- license details a contractor puts on paperwork but not the tax id
-- (EIN or similar) that goes next to them; give it a column of its own.
--
-- Idempotent; safe as one paste and safe to run twice.

begin;

alter table company_profile
  add column if not exists tax_id text;

comment on column company_profile.tax_id is
  'Company tax identification number (EIN or similar), free text -- formats vary by entity and state.';

commit;
