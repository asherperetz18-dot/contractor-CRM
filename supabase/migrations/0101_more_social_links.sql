begin;

-- The rest of the social profiles (0050 added Facebook and Instagram).
-- One nullable column per network, same rule as before: a company with
-- no LinkedIn page should show no LinkedIn link anywhere -- blank means
-- absent, never a dead link.
alter table company_profile add column linkedin_url text;
alter table company_profile add column youtube_url text;
alter table company_profile add column tiktok_url text;
alter table company_profile add column yelp_url text;
alter table company_profile add column google_reviews_url text;

commit;
