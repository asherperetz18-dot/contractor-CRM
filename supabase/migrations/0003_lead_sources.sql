-- Lead source integrations: a generic inbound webhook (website forms,
-- Zapier, any external system) and Meta (Facebook/Instagram) Lead Ads.

alter table company_profile add column webhook_secret text;
alter table company_profile add column meta_page_id text;
alter table company_profile add column meta_page_access_token text;
alter table company_profile add column meta_verify_token text;
alter table company_profile add column meta_app_secret text;
