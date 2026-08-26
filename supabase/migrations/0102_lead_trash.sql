begin;

-- The trash can. Deleting a contact used to be instant and total: the
-- row and every cascade child (estimates included) gone in one click,
-- with restore meaning "find a backup". Now the delete action snapshots
-- the contact and everything attached into this table first, and a
-- restore re-inserts it all with the original ids. Rows older than 30
-- days are purged opportunistically by later deletes.
create table lead_trash (
  id uuid primary key default gen_random_uuid(),
  -- The contact's original id, kept so a restore recreates it exactly
  -- and so links elsewhere (Drive folder names, old texts) still match.
  lead_id uuid not null,
  company_id uuid not null references companies (id) on delete cascade,
  -- Shown in the trash list without opening the payload.
  display_name text,
  deleted_by uuid references profiles (id) on delete set null,
  deleted_at timestamptz not null default now(),
  -- { lead, children: {table: rows...}, relinks: {table: ids...} }
  payload jsonb not null
);

create index lead_trash_company_idx on lead_trash (company_id, deleted_at desc);

alter table lead_trash enable row level security;

-- Reading the trash is for the people who could have deleted in the
-- first place: Admin, Office, or Sales with the delete grant.
create policy "lead_trash_select" on lead_trash for select to authenticated
  using (
    has_role_in_company('Admin', company_id)
    or can_delete_lead_in_company(company_id)
  );

-- No insert/update/delete policies on purpose: writes happen through
-- the service role inside the delete and restore actions, which check
-- permission themselves.

commit;
