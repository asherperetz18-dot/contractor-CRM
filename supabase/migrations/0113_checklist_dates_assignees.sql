-- Checklist steps grow up: a planned date, an owner, and templates
-- that schedule themselves off the signing day.
begin;

alter table project_checklist_items
  add column if not exists due_date date;
alter table project_checklist_items
  add column if not exists assigned_to uuid references profiles(id) on delete set null;

-- One template per company may auto-apply the moment a contract is
-- signed; the action layer keeps it to one.
alter table checklist_templates
  add column if not exists auto_apply boolean not null default false;

commit;
