-- Per-company email sender, matching the twilio_* columns' pattern: a
-- company can set its own From address (and optionally its own Resend
-- API key), falling back to the platform's shared sender when unset.
--
-- Unlike Twilio, a custom From address does not strictly require a
-- separate API key -- Resend lets one account send from multiple
-- verified domains, so a company can set just its own address while the
-- platform's key still does the sending, or bring a fully separate
-- Resend account of its own.
alter table company_profile add column email_from text;
alter table company_profile add column email_from_name text;
alter table company_profile add column resend_api_key_enc text;
alter table company_profile add column email_connected_at timestamptz;
