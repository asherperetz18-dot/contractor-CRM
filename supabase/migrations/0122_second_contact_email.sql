-- The second contact gets an email. The spouse / co-owner block on the
-- client card carried a name and phone but no address for the person
-- who most often actually reads the estimate. Document emails now go
-- to both when it is set.
--
-- Idempotent; safe as one paste and safe to run twice.

begin;

alter table leads
  add column if not exists second_contact_email text;

commit;
