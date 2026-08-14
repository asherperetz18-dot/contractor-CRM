begin;

-- Drawn e-signatures.
--
-- Every signature so far has been a typed name -- signature_name is
-- literally "what they actually typed" (see 0059). That is enough to bind
-- an agreement, but it is not what a homeowner expects when a document
-- asks them to "sign" it. This adds a real drawn mark alongside the typed
-- name, without touching how a typed-only signature already works: a
-- customer who still only types their name gets exactly the same record
-- as before, and signature_image simply stays null for them.
alter table estimate_signers
  add column if not exists signature_image text,
  add column if not exists signature_type text not null default 'typed'
    check (signature_type in ('typed', 'drawn'));

comment on column estimate_signers.signature_image is
  'A hand-drawn signature captured on the portal, as a base64 PNG data URL. Null for a typed-only signature.';
comment on column estimate_signers.signature_type is
  'How this signer actually signed -- typed their name, or drew a mark. Governs whether signature_image is shown.';

-- The "Dba" line on the reference proposal email template has nowhere to
-- come from today -- company_profile has a legal name but no assumed/DBA
-- name, which is a separate, common thing for a contractor to operate
-- under.
alter table company_profile
  add column if not exists dba text;

comment on column company_profile.dba is
  'The "doing business as" name shown on customer-facing documents and emails, if different from the legal company name.';

commit;
