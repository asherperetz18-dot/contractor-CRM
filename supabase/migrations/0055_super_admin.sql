begin;

-- A break-glass flag on the person, not on a membership: a super admin
-- keeps full access in every company they belong to, and cannot be
-- demoted, archived or removed through the app by anyone -- including
-- themselves. Deliberately has no UI. Turning it on or off is a
-- deliberate database change, which is the point of a safety catch.
alter table profiles
  add column is_super_admin boolean not null default false;

update profiles
set is_super_admin = true
where lower(email) = 'asher@lahomecontractor.com';

commit;
