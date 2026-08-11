-- Change orders.
--
-- A change order is a small contract: line items, a price, a customer
-- signature, a document that gets sent and signed. All of that already
-- exists on estimates and is tested, so a change order is an estimate
-- with a parent rather than a parallel module -- which would mean a
-- second signing flow, a second portal page, and two places that can
-- disagree about what a customer agreed to.
--
-- Distinct from supersedes_id/version, which is a revision: a revision
-- REPLACES an estimate and recalls the old one. A change order ADDS to a
-- contract that stays exactly as signed, because the signed document is
-- the record of what was agreed and must not be rewritten afterwards.
--
-- Required in writing by CSLB, and by section 2 of the contract this
-- system now sends: "obtain approval through a signed Change Order
-- before performing any extra work."
--
-- Run each step on its own. No begin/commit.

-- ---------------------------------------------------------------- step 1
alter table estimates add column if not exists kind text not null default 'contract';

-- on delete cascade: a change order has no meaning without its contract,
-- and an orphan would be a signed document belonging to nothing.
alter table estimates add column if not exists parent_estimate_id uuid
  references estimates(id) on delete cascade;

-- ---------------------------------------------------------------- step 2
create index if not exists estimates_parent_idx
  on estimates (parent_estimate_id) where parent_estimate_id is not null;

-- ---------------------------------------------------------------- step 3
-- Proof rather than a success message. Every existing row must read
-- 'contract' -- a change order that appeared retroactively would be
-- excluded from commission and double-counted in job totals.
select kind, count(*) as rows, count(parent_estimate_id) as with_parent
from estimates
group by kind
order by kind;
