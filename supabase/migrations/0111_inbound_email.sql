-- Inbound lead email: each company gets a private forwarding address
-- (leads-<token>@ the platform's receiving domain). The token in the
-- local part is what routes a forwarded email to the right pipeline.
begin;

alter table company_profile add column if not exists inbound_email_token text;

create unique index if not exists company_profile_inbound_email_token_idx
  on company_profile (inbound_email_token);

commit;
