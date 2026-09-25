-- Who deleted which customer file, and when.
--
-- Deleting a photo or document removes its lead_files row, so nothing
-- was left to say it had ever existed or who took it away. This table
-- is that record: deleteLeadFile snapshots the file as it stood (name,
-- type, which job it was filed under, who uploaded it and when) right
-- after the delete lands, and the job photo popup reads it back.
--
-- file_id is the deleted row's id, deliberately not a foreign key --
-- the row it pointed at is gone. estimate_id is set null if the job is
-- deleted later, the same way lead_files orphans back to the customer.
--
-- Append-only by policy: RLS grants select and insert to Office/Admin
-- (the same people lead_files_delete lets delete) and deliberately
-- grants no update or delete to anyone -- a history you can edit is
-- not a history. deleted_by is nullable so the trail survives a
-- profile deletion.
--
-- Idempotent; safe as one paste and safe to run twice.

begin;

create table if not exists lead_file_deletions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  lead_id uuid not null references leads (id) on delete cascade,
  estimate_id uuid references estimates (id) on delete set null,
  file_id uuid not null,
  file_name text not null,
  content_type text,
  storage_provider text,
  uploaded_by uuid references profiles (id) on delete set null,
  uploaded_at timestamptz,
  deleted_by uuid references profiles (id) on delete set null,
  deleted_at timestamptz not null default now()
);

comment on table public.lead_file_deletions is
  'Append-only history of deleted lead files: a snapshot of each file as it stood, who deleted it and when. Written by deleteLeadFile.';

create index if not exists lead_file_deletions_lead_idx
  on lead_file_deletions (lead_id, deleted_at desc);

alter table lead_file_deletions enable row level security;

drop policy if exists "lead_file_deletions_select" on lead_file_deletions;
create policy "lead_file_deletions_select" on lead_file_deletions for select
  to authenticated
  using (
    exists (
      select 1 from public.company_members m
      where m.profile_id = auth.uid()
        and m.company_id = lead_file_deletions.company_id
        and m.status = 'Active'
        and m.roles && array['Office', 'Admin']::app_role[]
    )
  );

-- Insert must also be attributed to its author: a row claiming to be
-- somebody else's delete is refused at the boundary, not by convention.
drop policy if exists "lead_file_deletions_insert" on lead_file_deletions;
create policy "lead_file_deletions_insert" on lead_file_deletions for insert
  to authenticated
  with check (
    deleted_by = auth.uid()
    and exists (
      select 1 from public.company_members m
      where m.profile_id = auth.uid()
        and m.company_id = lead_file_deletions.company_id
        and m.status = 'Active'
        and m.roles && array['Office', 'Admin']::app_role[]
    )
  );

commit;

-- Verify: the table exists with RLS on, and exactly two policies
-- (select, insert) -- no update, no delete.
select relrowsecurity as rls_enabled
from pg_class
where relname = 'lead_file_deletions';

select polname, polcmd
from pg_policy
where polrelid = 'public.lead_file_deletions'::regclass
order by polname;
