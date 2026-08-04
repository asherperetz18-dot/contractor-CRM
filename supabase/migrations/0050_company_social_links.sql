begin;

-- Social profiles for the company, alongside the existing website column.
-- Nullable: a company with no Facebook page should send no Facebook link,
-- not an empty label.
alter table company_profile
  add column facebook_url text,
  add column instagram_url text;

commit;
