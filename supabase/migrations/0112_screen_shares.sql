-- Live screen sharing between teammates: one row per sharing session.
-- The row is the discovery mechanism (who in my company is sharing right
-- now?) and the audit trail (who shared, when, for how long). The token
-- is the capability: knowing it is what admits a viewer to the WebRTC
-- handshake channel, so it never leaves the company (RLS below).
begin;

create table if not exists screen_shares (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  sharer_id uuid not null references profiles(id) on delete cascade,
  -- random hex minted by the app; names the signaling channel
  token text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create index if not exists screen_shares_active_idx
  on screen_shares (company_id, started_at desc)
  where ended_at is null;

alter table screen_shares enable row level security;

-- Any active member of the company can see its sessions (that is how a
-- viewer finds the share) and start their own; only the sharer ends
-- theirs.
create policy "screen_shares_select" on screen_shares for select
  to authenticated using (is_member_of_company(company_id));

create policy "screen_shares_insert" on screen_shares for insert
  to authenticated with check (
    is_member_of_company(company_id) and sharer_id = auth.uid()
  );

create policy "screen_shares_update" on screen_shares for update
  to authenticated
  using (sharer_id = auth.uid())
  with check (sharer_id = auth.uid());

commit;
