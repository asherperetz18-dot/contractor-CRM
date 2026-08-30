-- Screen share invites: the sharer picks WHO should watch, and that
-- person gets pinged directly instead of hoping they notice a banner.
--
-- invited_to null keeps today's behavior -- an open share any teammate
-- may join. When it is set, the select policy tightens to exactly the
-- sharer and the invitee: the row carries the session token, and the
-- token is the capability that admits a viewer to the WebRTC handshake
-- channel. A targeted session's ticket should not be readable by the
-- seventeen colleagues it wasn't meant for.
--
-- Idempotent; safe as one paste and safe to run twice.

begin;

alter table screen_shares
  add column if not exists invited_to uuid references profiles (id) on delete set null;

drop policy if exists "screen_shares_select" on screen_shares;
create policy "screen_shares_select" on screen_shares for select
  to authenticated using (
    is_member_of_company(company_id)
    and (
      invited_to is null
      or invited_to = auth.uid()
      or sharer_id = auth.uid()
    )
  );

commit;
