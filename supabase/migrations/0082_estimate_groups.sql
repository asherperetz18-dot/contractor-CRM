-- Sections on an estimate: Kitchen, Bathroom, Exterior.
--
-- A table rather than a text column on each line. A text field would mean
-- renaming "Kitchen" touches every row, groups could not be reordered
-- independently of the lines inside them, and an empty group could not
-- exist while somebody is still building it.
--
-- Distinct from the existing "Includes" behaviour, where an unpriced line
-- folds under the priced line above it. That stays exactly as it is;
-- sections sit above it, so a group contains priced lines and each of
-- those can still carry its own unpriced detail.
--
-- Run each step on its own. No begin/commit.

-- ---------------------------------------------------------------- step 1
create table if not exists estimate_groups (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  estimate_id uuid not null references estimates(id) on delete cascade,
  name text not null,
  -- Shown under the heading on the customer's copy: "Removing existing
  -- tile and disposing of debris is included."
  description text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- step 2
create index if not exists estimate_groups_doc_idx
  on estimate_groups (estimate_id, sort_order);

-- Null means ungrouped, which is how every existing line stays exactly as
-- it reads today.
--
-- set null, not cascade: deleting a section must not delete the priced
-- work inside it. Someone tidying up headings would otherwise wipe out
-- $12,000 of cabinets and only find out when the total moved.
alter table estimate_items add column if not exists group_id uuid
  references estimate_groups(id) on delete set null;

create index if not exists estimate_items_group_idx
  on estimate_items (group_id) where group_id is not null;

-- ---------------------------------------------------------------- step 3
alter table estimate_groups enable row level security;

-- Read and write follow the estimate itself. A section heading is part of
-- the document the customer signs, so it cannot be visible to anyone the
-- document is not, nor editable by anyone who cannot edit the document.
drop policy if exists "estimate_groups_select" on estimate_groups;
create policy "estimate_groups_select" on estimate_groups for select
  to authenticated using (
    is_member_of_company(company_id)
    and can_view_estimates_in_company(company_id)
  );

drop policy if exists "estimate_groups_write" on estimate_groups;
create policy "estimate_groups_write" on estimate_groups for all
  to authenticated
  using (
    is_member_of_company(company_id)
    and can_create_estimates_in_company(company_id)
  )
  with check (
    is_member_of_company(company_id)
    and can_create_estimates_in_company(company_id)
  );

-- ---------------------------------------------------------------- step 4
-- Proof rather than a success message.
select
  (select count(*) from information_schema.tables
    where table_name = 'estimate_groups') as table_created,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'estimate_groups') as policies,
  (select count(*) from information_schema.columns
    where table_name = 'estimate_items' and column_name = 'group_id') as item_link;
