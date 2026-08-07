begin;

-- A CSV import wrote the phone number into the email column on 639 rows.
-- 621 of them hold exactly the same digits as the phone on the same row,
-- so clearing the email loses no information -- the number is still on
-- the record, in the field that means "phone".
--
-- Why this matters beyond tidiness: only 212 of 1,508 contacts have a
-- real email address. Every email-based feature -- the client portal,
-- any send, duplicate matching -- was quietly treating a phone number as
-- an address for a third of the book.
--
-- The digit-length and equality tests are what keep this to the 621.
-- The other 18 rows carry free text in BOTH phone and email ("Wrong
-- number", "Spam", a person's name) and are deliberately untouched:
-- there is no number hiding in them to preserve, and deciding what those
-- records should say is a judgement call, not a migration.
update leads
set email = null
where email is not null
  and email not like '%@%'
  and phone is not null
  and length(regexp_replace(email, '\D', '', 'g')) >= 10
  and right(regexp_replace(email, '\D', '', 'g'), 10)
      = right(regexp_replace(phone, '\D', '', 'g'), 10);

commit;
