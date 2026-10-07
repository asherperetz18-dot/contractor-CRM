-- 0218: financing through the customer's own lender (DECISIONS #168).
--
-- Financing on an estimate (#162-#167) knew one lender: the company's
-- own (0214). Some customers finance the job themselves, through their
-- own bank or credit union. Each estimate now says who is financing it,
-- and every step, payment change and payout carries that lender's name.
--
--   * estimates.financing_source: 'company' (the company's lender, also
--     what an estimate with none set means), 'customer' (their own
--     lender, named in financing_lender) or 'none' (not financing).
--   * estimate_financing_events.lender: the lender a step was with.
--   * contract_payment_changes.own_lender: the payment change is to be
--     paid through the customer's own loan, so it's worded that way and
--     offers no link to apply.
--
-- Columns are added, nothing is removed: the running code checks for
-- them and works as before without them. Run in the Supabase SQL editor.
-- Safe to run twice.

begin;

alter table public.estimates
  add column if not exists financing_source text
    check (financing_source is null or financing_source in ('company', 'customer', 'none')),
  add column if not exists financing_lender text
    check (financing_lender is null or length(financing_lender) between 1 and 120);

comment on column public.estimates.financing_source is
  'Who is financing this job (DECISIONS #168): company (the company''s lender; also when null), customer (financing_lender) or none.';

alter table public.estimate_financing_events
  add column if not exists lender text check (lender is null or length(lender) <= 120);

alter table public.contract_payment_changes
  add column if not exists own_lender boolean not null default false;

commit;

-- Check: should read true.
select
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'estimates' and column_name = 'financing_source'
  )
  and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'estimate_financing_events' and column_name = 'lender'
  )
  and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'contract_payment_changes' and column_name = 'own_lender'
  )
  as own_lender_ready;
