-- Settings -> Role Visibility (matches the real iBuildPro product): which
-- pages each role can open. Only stores overrides -- a role/page combo with
-- no row here falls back to the app's hardcoded default (see
-- defaultPageVisible in src/lib/data/types.ts), same as the real product's
-- "untouched cells follow the default" behavior.
create table role_page_visibility (
  id uuid primary key default gen_random_uuid(),
  role text not null,
  page_key text not null,
  visible boolean not null default true,
  unique (role, page_key)
);

alter table role_page_visibility enable row level security;

create policy "role_page_visibility_select" on role_page_visibility for select
  to authenticated using (true);
create policy "role_page_visibility_write" on role_page_visibility for all
  to authenticated using (has_role('Office') or has_role('Admin'))
  with check (has_role('Office') or has_role('Admin'));
