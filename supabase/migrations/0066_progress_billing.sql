begin;

-- Progress billing: turning the payment schedule on a signed contract
-- into money that can actually be collected.
--
-- A phase is a milestone ("at completion of rough-in"), not a date, so
-- nothing on it can be due until the contractor says the work behind it
-- is done. requested_at is that moment: it is what makes a phase payable
-- in the portal, and it is what starts the clock on due_date. Leaving
-- both null on every existing row is correct -- nothing has been billed.
--
-- Deliberately not a status column. Whether a phase is paid is already
-- answerable from portal_payments, and a second copy of that fact would
-- be one webhook failure away from disagreeing with the money.
alter table estimate_payments
  add column if not exists requested_at timestamptz,
  add column if not exists due_date date;

-- Which phase a payment settles. Without it a schedule holding two
-- $5,375 phases cannot say which one was paid -- an amount is not an
-- identity. Null stays valid: that is what a deposit is.
alter table portal_payments
  add column if not exists estimate_payment_id uuid
    references estimate_payments(id) on delete set null;

create index if not exists portal_payments_phase_idx
  on portal_payments (estimate_payment_id)
  where estimate_payment_id is not null;

commit;
