-- Customer/Rep confirmation status on appointments, matching the real
-- iBuildPro product's appointment detail panel.
alter table events add column customer_confirmed boolean not null default false;
alter table events add column rep_confirmed boolean not null default false;
