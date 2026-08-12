-- Photos on estimates, contracts and change orders.
--
-- A link table rather than a second file store. The photos are already
-- in lead_files -- job photos taken on a visit, images sent over
-- WhatsApp -- and copying them would give one photograph two rows, two
-- captions and two chances to be corrected in only one place.
--
-- Attaching is what makes a photo customer-visible. Files on the lead
-- stay internal; nothing reaches the homeowner until somebody puts it in
-- a document deliberately. That is a simpler rule than a per-file
-- visibility flag and much harder to get wrong.
--
-- Change orders are estimates with kind='change_order', so this covers
-- them by construction. That is where photos do the most work: B&P 7159
-- already requires the change in writing before the work starts, and a
-- picture of the rot behind the wall is what turns "trust me" into a
-- record.
--
-- Run each step on its own. No begin/commit.

-- ---------------------------------------------------------------- step 1
create table if not exists estimate_files (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  estimate_id uuid not null references estimates(id) on delete cascade,

  -- The line this photo justifies. Null means it belongs to the document
  -- as a whole -- site context rather than evidence for one charge.
  estimate_item_id uuid references estimate_items(id) on delete cascade,

  -- The file itself, still owned by the lead.
  lead_file_id uuid not null references lead_files(id) on delete cascade,

  -- "Rot found behind shower wall once tile removed, 8/11". A photo
  -- without one is a picture; with one it is evidence.
  caption text,
  sort_order int not null default 0,

  created_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);

-- ---------------------------------------------------------------- step 2
-- One attachment per file per document. Attaching the same photo twice
-- is always a mis-click, and it prints twice on the customer's copy.
create unique index if not exists estimate_files_once
  on estimate_files (estimate_id, lead_file_id);

create index if not exists estimate_files_doc_idx
  on estimate_files (estimate_id, sort_order);

create index if not exists estimate_files_item_idx
  on estimate_files (estimate_item_id) where estimate_item_id is not null;

-- ---------------------------------------------------------------- step 3
alter table estimate_files enable row level security;

-- Read follows the estimate exactly. A photo attached to a document is
-- part of that document, so it cannot be visible to anyone the document
-- is not.
drop policy if exists "estimate_files_select" on estimate_files;
create policy "estimate_files_select" on estimate_files for select
  to authenticated using (
    is_member_of_company(company_id)
    and can_view_estimates_in_company(company_id)
  );

-- Writing follows estimate-create, not the cost permission: attaching a
-- photo changes what the customer is being asked to sign.
drop policy if exists "estimate_files_write" on estimate_files;
create policy "estimate_files_write" on estimate_files for all
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
    where table_name = 'estimate_files') as table_created,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'estimate_files') as policies,
  (select count(*) from pg_indexes
    where indexname = 'estimate_files_once') as dup_guard;
