-- Backfill for 0045. Portal access is now required to use the portal, and
-- every lead starts with it null (= no access). Anyone holding a working
-- session right now would be kicked out the moment the enforcement code
-- deploys, which is a regression rather than the intended behaviour.
--
-- Grant those customers the normal rolling window so their access simply
-- continues; it will lapse on its own if they stop visiting.

begin;

update leads
set portal_access_expires_at = now() + interval '10 days'
where portal_access_expires_at is null
  and id in (
    select lead_id from portal_sessions where expires_at > now()
  );

commit;
