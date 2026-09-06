-- One-time repair: customer signature lines that fell out of step with
-- the client card.
--
-- An estimate copies the client's name onto its customer signer row when
-- it is created, and that copy never used to change. A contact renamed
-- after the estimate was written kept the old name under the customer's
-- signature line while the "Prepared for" header (drawn live from the
-- lead) showed the new one -- EST-1081 read "James Havens" under a
-- document prepared for Jeremy Johnson.
--
-- From now on the app rewrites these rows whenever the card is saved.
-- This pass fixes the documents written before that: unsigned customer
-- lines on unsigned, uncancelled documents only. Anything anybody has
-- signed is a contract and is left exactly as it was signed.
--
-- Row 0 is the client, row 1 the second contact -- the same slots
-- createEstimate fills. A second-contact line is only rewritten while
-- the card still has a second contact. A client whose name is blank on
-- the card keeps the name the row already had.
--
-- Idempotent; safe as one paste and safe to run twice.

begin;

update estimate_signers s
set name  = coalesce(nullif(trim(concat_ws(' ', l.first_name, l.last_name)), ''), s.name),
    email = l.email,
    phone = l.phone
from estimates e
join leads l on l.id = e.lead_id
where s.estimate_id = e.id
  and s.company_id = e.company_id
  and s.party = 'customer'
  and s.sort_order = 0
  and s.signed_at is null
  and e.status not in ('Signed', 'Void')
  and not exists (
    select 1 from estimate_signers x
    where x.estimate_id = e.id and x.party = 'customer' and x.signed_at is not null
  )
  and (
    s.name is distinct from coalesce(nullif(trim(concat_ws(' ', l.first_name, l.last_name)), ''), s.name)
    or s.email is distinct from l.email
    or s.phone is distinct from l.phone
  );

update estimate_signers s
set name  = coalesce(nullif(trim(concat_ws(' ', l.second_contact_first_name, l.second_contact_last_name)), ''), 'Co-owner'),
    email = l.second_contact_email,
    phone = l.second_contact_phone
from estimates e
join leads l on l.id = e.lead_id
where s.estimate_id = e.id
  and s.company_id = e.company_id
  and s.party = 'customer'
  and s.sort_order = 1
  and s.signed_at is null
  and e.status not in ('Signed', 'Void')
  and (
    nullif(trim(concat_ws(' ', l.second_contact_first_name, l.second_contact_last_name)), '') is not null
    or l.second_contact_email is not null
  )
  and not exists (
    select 1 from estimate_signers x
    where x.estimate_id = e.id and x.party = 'customer' and x.signed_at is not null
  )
  and (
    s.name is distinct from coalesce(nullif(trim(concat_ws(' ', l.second_contact_first_name, l.second_contact_last_name)), ''), 'Co-owner')
    or s.email is distinct from l.second_contact_email
    or s.phone is distinct from l.second_contact_phone
  );

commit;
