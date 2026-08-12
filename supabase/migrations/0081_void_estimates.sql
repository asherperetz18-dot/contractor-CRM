-- Voiding estimates, contracts and change orders.
--
-- deleteEstimate had no status check. Anyone with delete-leads
-- permission could hard-delete a Signed contract, and portal_payments
-- cascades on delete -- so one click destroyed the signed agreement, the
-- signatures, the payment schedule and the record that the customer had
-- paid. Nothing was left behind saying the document had ever existed.
--
-- The fix is two operations, chosen by the document rather than by the
-- person. A Draft nobody has seen can be deleted. Anything issued gets
-- voided: the record stays, with who, when and why. A signed contract
-- cannot be deleted at all, by anyone -- it is evidence of what was
-- agreed, and that is not a permissions question.
--
-- Run each step on its own. No begin/commit.

-- ---------------------------------------------------------------- step 1
-- ON ITS OWN. Postgres will not let a new enum value be *used* in the
-- same transaction that adds it -- run this with nothing else in the
-- editor, or step 2 fails with "unsafe use of new value of enum type".
alter type estimate_status add value if not exists 'Void';

-- ---------------------------------------------------------------- step 2
-- Who, when, and why. The reason is the point: "why is EST-1021
-- cancelled" is the question asked six months later, and a status alone
-- cannot answer it.
alter table estimates add column if not exists voided_at timestamptz;
alter table estimates add column if not exists voided_by uuid references profiles(id);
alter table estimates add column if not exists void_reason text;

-- Phases the customer was never asked for stop being receivables. Ones
-- already billed stay: the request genuinely went out, and erasing it
-- would leave a payment that arrives later with nothing to settle
-- against. Marked rather than deleted, so the schedule still reads as
-- what was planned.
alter table estimate_payments add column if not exists cancelled_at timestamptz;

-- Finding the live documents is now the common query, so it is worth an
-- index that skips the voided ones outright.
create index if not exists estimates_live_idx
  on estimates (company_id, status) where status <> 'Void';

-- ---------------------------------------------------------------- step 3
-- Proof rather than a success message.
select
  (select count(*) from pg_type t join pg_enum e on e.enumtypid = t.oid
    where t.typname = 'estimate_status' and e.enumlabel = 'Void') as void_status,
  (select count(*) from information_schema.columns
    where table_name = 'estimates'
      and column_name in ('voided_at', 'voided_by', 'void_reason')) as estimate_cols,
  (select count(*) from information_schema.columns
    where table_name = 'estimate_payments' and column_name = 'cancelled_at') as phase_col;
