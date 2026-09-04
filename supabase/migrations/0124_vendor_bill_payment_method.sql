-- How a vendor bill was paid. The payment dialog only had a "Check #"
-- box, which assumed every vendor gets a check; in practice it's Zelle,
-- a card, cash at the counter, a wire for the big ones. One column,
-- same vocabulary the customer-side manual payments use (cash, check,
-- zelle, wire, other) plus card. check_number stays as it is and now
-- means "the reference" -- check number, Zelle confirmation, last four.
--
-- Before this runs, recording a payment still works: the app drops the
-- method and keeps the payment rather than refuse it.
--
-- Idempotent; safe as one paste and safe to run twice.

begin;

alter table vendor_bill_payments add column if not exists method text;

commit;
