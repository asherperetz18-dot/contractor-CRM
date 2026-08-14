-- The customer's own punch list, written by them at the moment they sign
-- the completion certificate.
--
-- Kept apart from completion_notes, which is the contractor's list typed
-- in the office when the certificate is raised. They are different
-- claims by different people and collapsing them into one field would
-- make it impossible to tell later who said a thing was outstanding.
--
-- Printed on the certificate above the signature rather than filed
-- alongside it: the template's clause 2 says listed items remain the
-- contractor's responsibility and are not waived by signing, and that
-- promise is only kept if the items are actually on the document the
-- customer signed.
alter table public.estimates
  add column if not exists completion_customer_items text;

comment on column public.estimates.completion_customer_items is
  'Punch list / concerns entered by the customer when signing a completion certificate. Contractor-entered outstanding items live in completion_notes.';
