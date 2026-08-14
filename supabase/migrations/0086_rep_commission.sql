-- Sales rep commission, on the contract that earned it.
--
-- The only commission this app pays today is the dispatcher's -- 1% of
-- gross to whoever brought the lead in. Reps get nothing, so this is new
-- rather than an extension.
--
-- Two reps, not four. That is what actually happens here: a lead
-- occasionally gets a second closer, never a fourth.
--
-- Columns on estimates rather than a child table, because the maximum is
-- fixed at two and "the splits must total 100%" is then a check on one
-- row rather than an aggregate over several.
--
-- Run each step on its own. No begin/commit.

-- ---------------------------------------------------------------- step 1
-- Who is paid, and in what proportion. Basis points, so 10000 = 100% and
-- a 60/40 split is exact rather than 0.6 repeating.
alter table estimates add column if not exists sales_rep_1 uuid references profiles(id);
alter table estimates add column if not exists sales_rep_1_bp int not null default 10000;
alter table estimates add column if not exists sales_rep_2 uuid references profiles(id);
alter table estimates add column if not exists sales_rep_2_bp int not null default 0;

-- ---------------------------------------------------------------- step 2
-- The rate and the lead cost are stamped on the contract, not read live
-- from settings.
--
-- Same reasoning as the deposit percentage and the frozen terms text: a
-- contract signed in March at 8% must still pay 8% after the company
-- moves to 6% in June. Reading the setting at report time would silently
-- restate what everybody has already been paid.
--
-- Null means "not set yet" and is deliberately distinct from zero, so a
-- contract from before this existed does not claim a 0% rate was chosen.
alter table estimates add column if not exists commission_rate_bp int;
alter table estimates add column if not exists lead_cost_bp int;

-- The company defaults these are stamped from: 50% of net profit to the
-- reps, after a 15% lead cost. Both are this company's actual figures
-- rather than invented ones, and both are editable per contract.
alter table company_profile add column if not exists sales_commission_bp int not null default 5000;
alter table company_profile add column if not exists sales_lead_cost_bp int not null default 1500;

-- ---------------------------------------------------------------- step 3
-- Finding a rep's own contracts is the report's main query, and a rep may
-- appear in either slot.
create index if not exists estimates_sales_rep_1_idx
  on estimates (company_id, sales_rep_1) where sales_rep_1 is not null;
create index if not exists estimates_sales_rep_2_idx
  on estimates (company_id, sales_rep_2) where sales_rep_2 is not null;

-- ---------------------------------------------------------------- step 4
-- Proof rather than a success message. Expect 6 and 2.
select
  (select count(*) from information_schema.columns
    where table_name = 'estimates'
      and column_name in ('sales_rep_1','sales_rep_1_bp','sales_rep_2','sales_rep_2_bp',
                          'commission_rate_bp','lead_cost_bp')) as estimate_cols,
  (select count(*) from information_schema.columns
    where table_name = 'company_profile'
      and column_name in ('sales_commission_bp','sales_lead_cost_bp')) as settings_cols;
