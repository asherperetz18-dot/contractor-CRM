-- "Date Received" -- editable per-lead, separate from created_at (which is
-- the system insert timestamp and shouldn't be user-editable). Backfill
-- existing leads from their created_at date, then default new leads to
-- today.
alter table leads add column date_received date;
update leads set date_received = created_at::date where date_received is null;
alter table leads alter column date_received set default current_date;
alter table leads alter column date_received set not null;
