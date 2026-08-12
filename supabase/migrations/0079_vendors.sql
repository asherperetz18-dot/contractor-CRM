-- Vendors, so a supplier is a record rather than a spelling.
--
-- job_expenses.vendor is free text today, which is how "Home Depot",
-- "home depot" and "HomeDepot" become three suppliers. This company has
-- already been through that once with lead sources and needed a merge
-- tool built to clean it up -- worth preventing rather than curing twice.
--
-- The unique index on the lowercased name is what actually prevents it.
-- A dropdown only helps people who use the dropdown; the database
-- refusing the duplicate helps everyone.
--
-- Deliberately absent: tax IDs. EINs and SSNs are needed for 1099s and
-- belong in QuickBooks, which is built to hold them and already has
-- them. This records only whether the W-9 is on file, which answers the
-- question actually asked in January -- whose am I missing -- without
-- the CRM ever storing the number.
--
-- Run each step on its own. No begin/commit.

-- ---------------------------------------------------------------- step 1
create table if not exists vendors (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,

  -- "Lumber", "Electrical sub". What they do, for grouping spend.
  trade text,
  -- Prefills the category on a cost when this vendor is picked. The
  -- point of the picker is fewer keystrokes, not just tidier ones.
  default_category text,

  contact_name text,
  phone text,
  email text,
  address text,

  -- Subcontractors. An expired certificate on someone working your job
  -- is your exposure, and nothing in this system would otherwise say so.
  license_number text,
  insurance_expires_on date,

  -- Whether the form is on file, never the number on it.
  w9_on_file boolean not null default false,
  w9_received_on date,

  notes text,

  -- Unused until the QuickBooks sync lands, when "Home Depot" there has
  -- to resolve to "Home Depot" here. Free now; a retrofit later means
  -- touching every row.
  qb_vendor_id text,

  -- Archived rather than deleted: a vendor with costs against it must
  -- not vanish from history because nobody uses them any more.
  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);

-- ---------------------------------------------------------------- step 2
-- The actual guard against a fragmented list.
create unique index if not exists vendors_one_name_per_company
  on vendors (company_id, lower(name));

create index if not exists vendors_company_active_idx
  on vendors (company_id, is_active, name);

-- Costs point at a vendor record. The old free-text column stays: rows
-- already written have no vendor to point at, and a QuickBooks import
-- whose supplier is not in the list yet still needs somewhere to put the
-- name rather than dropping it.
alter table job_expenses add column if not exists vendor_id uuid
  references vendors(id) on delete set null;

create index if not exists job_expenses_vendor_idx
  on job_expenses (vendor_id) where vendor_id is not null;

-- ---------------------------------------------------------------- step 3
alter table vendors enable row level security;

-- Any active member may read one. A field lead needs to know which sub
-- is on the job and how to reach them; this is a trade directory, not
-- margin data.
drop policy if exists "vendors_select" on vendors;
create policy "vendors_select" on vendors for select
  to authenticated using (is_member_of_company(company_id));

-- Writing is the cost permission -- the same people who enter receipts,
-- so nobody is blocked halfway through a stack of them by a supplier
-- that is not on the list yet.
drop policy if exists "vendors_write" on vendors;
create policy "vendors_write" on vendors for all
  to authenticated
  using (
    is_member_of_company(company_id)
    and can_manage_costs_in_company(company_id)
  )
  with check (
    is_member_of_company(company_id)
    and can_manage_costs_in_company(company_id)
  );

-- ---------------------------------------------------------------- step 4
-- Proof rather than a success message.
select
  (select count(*) from information_schema.tables where table_name = 'vendors') as table_created,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'vendors') as policies,
  (select count(*) from information_schema.columns
    where table_name = 'job_expenses' and column_name = 'vendor_id') as vendor_link,
  (select count(*) from pg_indexes where indexname = 'vendors_one_name_per_company') as dup_guard;
