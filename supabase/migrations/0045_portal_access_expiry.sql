-- Customer portal access is a grant with its own lifetime (10 days by
-- default), renewable by office staff -- separate from the 30-minute
-- sign-in link and the browser session.
--
-- Enforced on sign-in AND on every portal page load, so an already
-- signed-in customer loses access the moment the grant lapses rather than
-- keeping a live session for the rest of its 30 days.

begin;

alter table leads add column portal_access_expires_at timestamptz;

commit;
