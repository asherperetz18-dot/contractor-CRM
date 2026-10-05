-- Facebook Page token and app secret stored encrypted (DECISIONS #112).
--
-- They were kept in plain text in company_profile, a table every member
-- of the company can read. From this release the CRM stores them
-- encrypted, in the two new *_enc columns, the same way as the Twilio,
-- Stripe and Resend keys.
--
-- This migration clears the plain copies straight away. The CRM can't be
-- asked to encrypt inside SQL (the key lives on the server), so each
-- company's plain values are first moved into meta_secrets_legacy: RLS on,
-- no policies, and no rights for anon/authenticated, so no CRM user can
-- read it. Only the server (service role) does: the first time it needs a
-- company's Facebook keys it encrypts them into company_profile and
-- deletes that company's row here. Leads keep arriving throughout.
--
-- Safe to run twice.

alter table public.company_profile
  add column if not exists meta_page_access_token_enc text,
  add column if not exists meta_app_secret_enc text;

create table if not exists public.meta_secrets_legacy (
  company_id uuid primary key references public.companies (id) on delete cascade,
  page_access_token text,
  app_secret text,
  moved_at timestamptz not null default now()
);

alter table public.meta_secrets_legacy enable row level security;
revoke all on public.meta_secrets_legacy from anon, authenticated;

insert into public.meta_secrets_legacy (company_id, page_access_token, app_secret)
select company_id, meta_page_access_token, meta_app_secret
from public.company_profile
where meta_page_access_token is not null or meta_app_secret is not null
on conflict (company_id) do update
  set page_access_token = coalesce(excluded.page_access_token, public.meta_secrets_legacy.page_access_token),
      app_secret = coalesce(excluded.app_secret, public.meta_secrets_legacy.app_secret);

update public.company_profile
set meta_page_access_token = null,
    meta_app_secret = null
where meta_page_access_token is not null or meta_app_secret is not null;

-- A table with company_id gets the unpaid-account lock (0175), like every
-- tenant table. With no other policy it still grants nothing.
select public.apply_billing_lock_policies();

-- Check: plain_left should be 0. moved_aside is how many companies had
-- Facebook keys; it drops to 0 as the CRM encrypts each one.
select
  (select count(*) from public.company_profile
    where meta_page_access_token is not null or meta_app_secret is not null) as plain_left,
  (select count(*) from public.meta_secrets_legacy) as moved_aside;
