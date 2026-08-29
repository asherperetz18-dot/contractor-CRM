-- CallRail call tracking: per-company credentials, and room on call_logs
-- for calls that arrive from CallRail instead of Twilio.
begin;

-- Same shape as the Twilio/Stripe/Resend credentials: identifiers in
-- plaintext, secrets encrypted (_enc, AES-256-GCM under APP_ENCRYPTION_KEY).
alter table company_profile add column if not exists callrail_account_id text;
alter table company_profile add column if not exists callrail_company_id text;
alter table company_profile add column if not exists callrail_company_name text;
alter table company_profile add column if not exists callrail_api_key_enc text;
alter table company_profile add column if not exists callrail_signing_key_enc text;
alter table company_profile add column if not exists callrail_connected_at timestamptz;

-- CallRail's id for the call, so a webhook delivery and the nightly
-- backfill of the same call land as ONE row. Unique treats NULLs as
-- distinct, so the thousands of Twilio rows (all NULL here) are untouched.
alter table call_logs add column if not exists callrail_call_id text;
-- Which marketing brought the phone call: "Google Ads · spring-roofing ·
-- 'kitchen remodel'". The whole point of connecting CallRail.
alter table call_logs add column if not exists marketing_source text;

create unique index if not exists call_logs_callrail_call_idx
  on call_logs (company_id, callrail_call_id);

commit;
