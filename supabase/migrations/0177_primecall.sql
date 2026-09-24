-- PrimeCall (NetSapiens) phone system: per-company connection, and room
-- on call_logs for calls that arrive from PrimeCall. Safe to run twice.
begin;

-- Same shape as the CallRail/Twilio credentials: identifiers in
-- plaintext, secrets encrypted (_enc, AES-256-GCM under APP_ENCRYPTION_KEY).
alter table company_profile add column if not exists primecall_server text;
alter table company_profile add column if not exists primecall_domain text;
alter table company_profile add column if not exists primecall_api_key_enc text;
-- The secret in the webhook URL PrimeCall posts finished calls to.
alter table company_profile add column if not exists primecall_webhook_token_enc text;
-- NetSapiens' id for that event subscription, so Disconnect can remove it.
alter table company_profile add column if not exists primecall_subscription_id text;
alter table company_profile add column if not exists primecall_connected_at timestamptz;

-- PrimeCall's id for the call (call-orig-call-id), so the live feed and
-- the 15-minute sweep of the same call land as ONE row. Unique treats
-- NULLs as distinct, so every Twilio/CallRail row is untouched.
alter table call_logs add column if not exists primecall_call_id text;

create unique index if not exists call_logs_primecall_call_idx
  on call_logs (company_id, primecall_call_id);

commit;
