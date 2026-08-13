-- A customer's YES now moves the status too.
--
-- customer_confirmed is what the "reply YES to confirm" text sets; status
-- is what the calendar's filter chips read. Nothing wrote both, so the
-- two drifted apart and the Confirmed filter hid appointments the
-- customer had already confirmed.
--
-- The application change is the fix going forward. This is the backfill
-- for rows already out of step, and it promotes only from New: an
-- appointment that reached Showed, No-show or Cancelled has been through
-- something a person recorded, and a stale confirmation must not drag it
-- backwards.
--
-- Smaller than it first looked. 30 appointments carry customer_confirmed,
-- but 12 are already Showed, 1 No-show and 7 already Confirmed -- all
-- correct. Only 10 are genuinely stuck at New, 8 of them in the past.
update events
set status = 'Confirmed'
where customer_confirmed = true
  and status = 'New';

-- Proof rather than a success message. Expect 0.
select count(*) as still_out_of_step
from events
where customer_confirmed = true and status = 'New';
