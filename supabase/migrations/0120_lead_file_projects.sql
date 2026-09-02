-- Files filed under a job. A customer with two contracts has one file
-- store, so the Permits & contracts chip on both project rows showed
-- the same undivided pile -- bank statements next to the other job's
-- permit. lead_files now carries which contract a file belongs to;
-- null means "on the customer, not filed to any job yet", and the
-- per-project view offers to file those rather than hiding them.
--
-- on delete set null: deleting a contract must orphan its paperwork
-- back to the customer, never delete it.
--
-- Idempotent; safe as one paste and safe to run twice.

begin;

alter table lead_files
  add column if not exists estimate_id uuid references estimates (id) on delete set null;

create index if not exists lead_files_estimate_idx
  on lead_files (estimate_id)
  where estimate_id is not null;

commit;
