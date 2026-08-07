begin;

-- Deposit rule and progress-payment schedule.
--
-- The deposit is "10% or up to $1,000, whichever is LESS" -- not either
-- one alone. That is California's rule for home improvement contracts
-- (CSLB, B&P 7159): the down payment may not exceed $1,000 or 10% of the
-- contract price, whichever is less. Storing it as a percent plus a cap
-- rather than a typed number means a rep cannot accidentally collect an
-- illegal deposit on a large job.
alter table company_profile
  add column if not exists deposit_percent_bp int not null default 1000,   -- 10.00%
  add column if not exists deposit_cap_cents bigint not null default 100000; -- $1,000

-- Progress payments: the balance after the deposit, split into phases
-- that bill as work completes.
create table estimate_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  estimate_id uuid not null references estimates(id) on delete cascade,

  sort_order int not null default 0,
  name text not null default '',
  description text,

  -- Amount is authoritative and percent is derived for display. Storing
  -- both invites them to disagree after an edit, and the customer signs
  -- the dollar figure, not the percentage.
  amount_cents bigint not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint estimate_payments_amount_nonneg check (amount_cents >= 0)
);

create index estimate_payments_estimate_idx on estimate_payments (estimate_id, sort_order);

-- Snapshotted onto the estimate for the same reason tax_rate_bp is: the
-- company changing its deposit policy next year must not silently rewrite
-- the deposit on a contract somebody already signed.
alter table estimates
  add column if not exists deposit_percent_bp int not null default 1000,
  add column if not exists deposit_cap_cents bigint not null default 100000;

alter table estimate_payments enable row level security;

-- Follows the parent estimate exactly, like items and signers.
create policy "estimate_payments_select" on estimate_payments for select
  to authenticated using (
    is_member_of_company(company_id)
    and can_view_estimates_in_company(company_id)
    and estimate_visible_to_current_user(estimate_id)
  );

create policy "estimate_payments_write" on estimate_payments for all
  to authenticated using (
    can_create_estimates_in_company(company_id)
    and estimate_visible_to_current_user(estimate_id)
  )
  with check (can_create_estimates_in_company(company_id));

commit;
