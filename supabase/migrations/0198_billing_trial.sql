-- Free trial (DECISIONS #129).
--
-- A self-serve signup now starts with 30 days free and no card, run by
-- Stripe. These two columns let the CRM count the trial down and know
-- whether a card is waiting for its end:
--   trial_ends_at -- when the company's trial ends (or ended)
--   card_on_file  -- whether Stripe has a card to charge then
-- Both are filled by the billing sync, from Stripe; nobody types them.
--
-- Until this runs the trial still works (Stripe runs it), but the banner
-- can't say how many days are left. Safe to run twice.

alter table public.company_billing
  add column if not exists trial_ends_at timestamptz,
  add column if not exists card_on_file boolean;

-- Check: should read true.
select count(*) = 2 as billing_trial_ready
from information_schema.columns
where table_schema = 'public'
  and table_name = 'company_billing'
  and column_name in ('trial_ends_at', 'card_on_file');
