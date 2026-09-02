-- Contracts signed on paper. Some jobs are signed at the kitchen table
-- with a pen; the office then records the document in the CRM without
-- anything being sent to the customer. The signer row for those carries
-- signature_type 'paper' -- honest about how the signature happened:
-- no drawn mark, no typed name from a portal session, a staff member
-- attesting to ink on a page (with the scan attached on the contact).
--
-- Idempotent; safe as one paste and safe to run twice.

begin;

alter table estimate_signers
  drop constraint if exists estimate_signers_signature_type_check;
alter table estimate_signers
  add constraint estimate_signers_signature_type_check
  check (signature_type in ('typed', 'drawn', 'paper'));

commit;
