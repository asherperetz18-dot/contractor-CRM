-- The notification bell's read state: one timestamp per person per
-- company -- "I have seen everything up to here". The feed itself is
-- computed live from the tables that already hold the facts (failed
-- texts, overdue phases, proposal views, checklist due dates), so this
-- is the only storage the bell needs, and "Mark all read" is one upsert.

begin;

create table if not exists notification_reads (
  profile_id uuid not null references profiles (id) on delete cascade,
  company_id uuid not null references companies (id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (profile_id, company_id)
);

alter table notification_reads enable row level security;

-- Strictly your own row: reading someone else's watermark tells you
-- when they last looked at their notifications, which is nobody's
-- business, and writing it could silence another person's bell.
drop policy if exists "notification_reads_own" on notification_reads;
create policy "notification_reads_own" on notification_reads for all
  to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

commit;
