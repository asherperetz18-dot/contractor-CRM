-- "Connect with Facebook" on Settings -> Facebook Lead Ads (DECISIONS #080).
--
-- A company now connects its Page by signing in with Facebook instead of
-- pasting a Page id, token and app secret. The token still lives in
-- meta_page_access_token (0003); these columns record which Page it is
-- by name, how it was connected, and when.
--
-- meta_connected_via = 'facebook_login' means the Page is subscribed to
-- the CRM's own Meta app, so /api/meta/leadgen checks its webhooks with
-- the deployment's META_APP_SECRET. Null means the older manual setup
-- with the company's own app and secret, unchanged.
--
-- Idempotent: safe to paste and run more than once.

alter table public.company_profile add column if not exists meta_page_name text;
alter table public.company_profile add column if not exists meta_connected_via text;
alter table public.company_profile add column if not exists meta_connected_at timestamptz;

-- One Page, one company. The webhook finds the company by Page id with
-- maybeSingle(), so two companies holding the same Page would drop that
-- Page's leads for both. The app refuses the second connection already;
-- this makes it a rule. Skipped (with a notice) if duplicates already
-- exist, so the paste never fails half-way -- clear the duplicate Page
-- id and run this file again.
do $$
begin
  if exists (
    select 1 from public.company_profile
    where meta_page_id is not null
    group by meta_page_id having count(*) > 1
  ) then
    raise notice 'Two companies share a Facebook Page id -- unique index skipped. Clear one and re-run 0178.';
  else
    create unique index if not exists company_profile_meta_page_id_key
      on public.company_profile (meta_page_id)
      where meta_page_id is not null;
  end if;
end $$;
