-- Bills to Pay: the vendor side of the money. The CRM tracked money in
-- (payments) and money already spent (receipts) but nothing owed to
-- vendors before it is paid -- "what checks go out this week" had no
-- answer. Modeled on the page the company actually runs today:
-- per-project bills, partial payments as the norm, a scheduled pay
-- date per bill, and Overdue meaning past its SCHEDULED date.
--
-- A bill's lifecycle is derived, not stored: paid when its payments
-- cover it, scheduled when a date is set, void only when explicitly
-- voided. Stored status can drift from the payments beneath it;
-- arithmetic can't.
--
-- Idempotent; safe as one paste and safe to run twice.

begin;

create table if not exists vendor_bills (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  -- The supplier: a vendor record when one matches, free text when not
  -- (same pair job_expenses uses -- "Stucco Humberto" is a real payee).
  vendor_id uuid references vendors (id) on delete set null,
  vendor_name text,
  -- The job, via the lead like every cost; null is an unlinked bill
  -- (overhead, fuel, the office) and the page counts those separately.
  lead_id uuid references leads (id) on delete set null,
  reference text,
  amount_cents bigint not null,
  bill_date date,
  due_date date,
  -- When the company plans to pay it. The cash-planning date: the
  -- Scheduled tab, the this-week card and Overdue all read this.
  scheduled_date date,
  voided_at timestamptz,
  voided_by uuid references profiles (id) on delete set null,
  notes text,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vendor_bills_company_idx on vendor_bills (company_id, created_at desc);
create index if not exists vendor_bills_lead_idx on vendor_bills (lead_id) where lead_id is not null;

create table if not exists vendor_bill_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  bill_id uuid not null references vendor_bills (id) on delete cascade,
  amount_cents bigint not null,
  paid_on date not null,
  check_number text,
  note text,
  -- The job cost this payment wrote (a payment on a job-linked bill
  -- records itself as that job's expense, so Projects' Spent stays
  -- true with zero double entry). set null: deleting the expense by
  -- hand must not delete the payment record.
  job_expense_id uuid references job_expenses (id) on delete set null,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists vendor_bill_payments_bill_idx on vendor_bill_payments (bill_id);

alter table vendor_bills enable row level security;
alter table vendor_bill_payments enable row level security;

-- The cost-money roles: Bookkeeping, Office, Admin, Production (the
-- same database function the receipts ride). The page itself is shown
-- to Bookkeeping/Office/Admin by default; Production reaching the data
-- through RLS mirrors their existing cost access.
drop policy if exists "vendor_bills_all" on vendor_bills;
create policy "vendor_bills_all" on vendor_bills for all
  to authenticated
  using (is_member_of_company(company_id) and can_manage_costs_in_company(company_id))
  with check (is_member_of_company(company_id) and can_manage_costs_in_company(company_id));

drop policy if exists "vendor_bill_payments_all" on vendor_bill_payments;
create policy "vendor_bill_payments_all" on vendor_bill_payments for all
  to authenticated
  using (is_member_of_company(company_id) and can_manage_costs_in_company(company_id))
  with check (is_member_of_company(company_id) and can_manage_costs_in_company(company_id));

commit;
