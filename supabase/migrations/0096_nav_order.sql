-- 0096: company-wide sidebar order. Empty = the built-in order.
alter table company_profile
  add column if not exists nav_order text[] not null default '{}';
