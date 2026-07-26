-- Team Activity: lightweight usage tracking (page views + heartbeat pings)
-- so admins can see active users, session time, and top pages, matching
-- the real iBuildPro product's Admin Tools -> Team Activity page.

create table activity_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  session_id text not null,
  path text not null,
  kind text not null default 'heartbeat',
  created_at timestamptz not null default now()
);

create index activity_events_created_at_idx on activity_events (created_at);
create index activity_events_user_id_idx on activity_events (user_id);
create index activity_events_session_id_idx on activity_events (session_id);

alter table activity_events enable row level security;

-- Any signed-in user can log their own activity ping.
create policy "activity_events_insert_self" on activity_events for insert
  to authenticated with check (user_id = auth.uid());

-- Only Office/Admin can read the aggregate activity data.
create policy "activity_events_select_admin" on activity_events for select
  to authenticated using (has_role('Office') or has_role('Admin'));
