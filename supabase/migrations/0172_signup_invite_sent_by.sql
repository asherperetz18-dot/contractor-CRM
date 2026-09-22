-- Who sent a manual signup invite.
--
-- The Platform Admin page now lists every invite ever sent (paid or
-- manual) with its status. The one question that list couldn't answer
-- from the existing columns was "which admin clicked Send" -- 0131's
-- `source` says *which door*, not *who*. Null for a paid signup (nobody
-- sent it; the customer paid on the public page).
--
-- Safe to run twice. The code writes and reads this column when it
-- exists and falls back to the old shape when it doesn't, so nothing
-- breaks between merge and paste.
begin;

alter table signup_invites
  add column if not exists sent_by uuid references profiles (id) on delete set null;

commit;
