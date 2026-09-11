-- Cobrowse: a second way for a screen_shares session to travel. "screen"
-- is the existing WebRTC capture of a whole screen; "cobrowse" mirrors
-- just the CRM tab's DOM over the Realtime channel -- the only kind an
-- iPhone or iPad can send, since Apple blocks web pages from capturing
-- the screen. The row, token, invite targeting, and RLS are identical
-- either way (0112/0116 policies already cover this column's table);
-- kind only tells a joining viewer which protocol to speak.
--
-- Idempotent; safe as one paste and safe to run twice.

begin;

alter table screen_shares
  add column if not exists kind text not null default 'screen';

alter table screen_shares
  drop constraint if exists screen_shares_kind_check;
alter table screen_shares
  add constraint screen_shares_kind_check check (kind in ('screen', 'cobrowse'));

commit;
