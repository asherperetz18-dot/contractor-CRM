-- Google Drive connection for the "Cloud Storage" settings card. Tokens
-- live in their own table with NO select/insert/update policies for the
-- authenticated role at all -- only the service-role client (which
-- bypasses RLS) ever touches this table, via server actions/route
-- handlers, so OAuth tokens never reach the browser.
create table google_drive_connection (
  id int primary key default 1,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  connected_email text,
  folder_id text,
  connected_at timestamptz,
  constraint google_drive_connection_singleton check (id = 1)
);

alter table google_drive_connection enable row level security;

-- Track where each lead file actually lives so deletes/links know which
-- API to use. Existing rows default to 'supabase' (today's only option).
alter table lead_files add column storage_provider text not null default 'supabase';
