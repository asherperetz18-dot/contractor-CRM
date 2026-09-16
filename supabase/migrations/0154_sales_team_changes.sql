-- Who changed the sales team on a signed contract, and when.
--
-- The commission seats (sales_rep_1/2, closer_id, the shares and
-- rates -- 0086, 0135, 0153) are editable after signature by design:
-- the office corrects mistakes and settles mid-job handoffs. But the
-- commission statement computes live from whoever currently holds the
-- seats, so a swap restates the whole line with no record that it
-- was ever anyone else's. This table is that record.
--
-- Raw before/after snapshots of the eight team columns, described in
-- words at read time (src/lib/data/sales-team-changes.ts), so display
-- can improve without restating history. Append-only by policy: RLS
-- grants select and insert to Office/Admin (the same people
-- saveSalesTeam accepts) and deliberately grants no update or delete
-- to anyone -- an audit trail you can edit is not an audit trail.
--
-- changed_by is nullable so the trail survives a profile deletion;
-- a null reads as "system" in the UI.
--
-- Idempotent; safe as one paste and safe to run twice.

begin;

create table if not exists sales_team_changes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  estimate_id uuid not null references estimates (id) on delete cascade,
  changed_by uuid references profiles (id) on delete set null,
  changed_at timestamptz not null default now(),
  old_team jsonb not null,
  new_team jsonb not null
);

comment on table public.sales_team_changes is
  'Append-only audit of sales-team edits on contracts: raw before/after snapshots of the estimate team columns, one row per saveSalesTeam call that changed anything.';

create index if not exists sales_team_changes_estimate_idx
  on sales_team_changes (estimate_id, changed_at desc);

alter table sales_team_changes enable row level security;

-- The people who may read and write the panel (isAdminRole in the
-- app): active Office/Admin members of the same company.
drop policy if exists "sales_team_changes_select" on sales_team_changes;
create policy "sales_team_changes_select" on sales_team_changes for select
  to authenticated
  using (
    exists (
      select 1 from public.company_members m
      where m.profile_id = auth.uid()
        and m.company_id = sales_team_changes.company_id
        and m.status = 'Active'
        and m.roles && array['Office', 'Admin']::app_role[]
    )
  );

-- Insert must also be attributed to its author: a row claiming to be
-- somebody else's edit is refused at the boundary, not by convention.
drop policy if exists "sales_team_changes_insert" on sales_team_changes;
create policy "sales_team_changes_insert" on sales_team_changes for insert
  to authenticated
  with check (
    changed_by = auth.uid()
    and exists (
      select 1 from public.company_members m
      where m.profile_id = auth.uid()
        and m.company_id = sales_team_changes.company_id
        and m.status = 'Active'
        and m.roles && array['Office', 'Admin']::app_role[]
    )
  );

commit;

-- Verify: the table exists with RLS on, and exactly two policies
-- (select, insert) -- no update, no delete.
select relrowsecurity as rls_enabled
from pg_class
where relname = 'sales_team_changes';

select polname, polcmd
from pg_policy
where polrelid = 'public.sales_team_changes'::regclass
order by polname;
