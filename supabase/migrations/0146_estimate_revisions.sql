-- Revisions of a signed contract.
--
-- 0059 already declared the intent -- "editing one supersedes it with a
-- new version and leaves the original readable" -- and gave estimates the
-- supersedes_id and version columns for it. But the unique key on
-- (company_id, doc_number) forbade the second row ever existing: a
-- revision keeps the customer's document number, because the job is still
-- EST-1066 -- it is v5 of it -- and only the version moves.
--
-- Safe to widen: nothing in the app looks an estimate up by doc_number
-- (every lookup is by id; the number is display), so no query relies on
-- one row per number.
--
-- Run each step on its own. No begin/commit.

-- ---------------------------------------------------------------- step 1
alter table estimates drop constraint if exists estimates_doc_number_unique;

-- ---------------------------------------------------------------- step 2
alter table estimates add constraint estimates_doc_number_version_unique
  unique (company_id, doc_number, version);

-- ---------------------------------------------------------------- step 3
-- Proof rather than a success message: exactly one doc_number key exists
-- and it is the widened one. (No collision check needed -- the old key
-- was stricter, so existing rows already satisfy the new one.)
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'estimates'::regclass
  and conname like 'estimates_doc_number%';
