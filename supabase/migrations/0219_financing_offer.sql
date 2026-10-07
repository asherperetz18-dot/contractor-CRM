-- 0219: offering financing per customer, and the lender's fee (DECISIONS #169).
--
-- A lender keeps a fee from every loan it funds (often close to 10% of
-- the amount financed), so the company decides customer by customer
-- whether to offer financing, sees what it would cost first, and records
-- the fee as a job cost when a loan pays out.
--
--   * company_profile.financing_offer_default: whether new estimates
--     offer financing (true, as before, until the company changes it).
--   * company_profile.financing_fee_bp: the lender's fee, in hundredths
--     of a percent of the amount financed (990 = 9.9%). Only the
--     company's people ever see it.
--   * estimates.financing_offered: this estimate's own switch; null
--     follows the company's default.
--
-- Columns are added, nothing is removed: the running code checks for
-- them and offers financing as before without them. Run in the Supabase
-- SQL editor. Safe to run twice.

begin;

alter table public.company_profile
  add column if not exists financing_offer_default boolean not null default true,
  add column if not exists financing_fee_bp integer
    check (financing_fee_bp is null or financing_fee_bp between 0 and 5000);

alter table public.estimates
  add column if not exists financing_offered boolean;

comment on column public.estimates.financing_offered is
  'Offer financing to this customer (DECISIONS #169); null follows company_profile.financing_offer_default.';

commit;

-- Check: should read true.
select
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'company_profile' and column_name = 'financing_fee_bp'
  )
  and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'estimates' and column_name = 'financing_offered'
  )
  as financing_offer_ready;
