-- 0214: customer financing, step 1 (DECISIONS #161).
--
-- A company adds the application link from its own lender's dashboard
-- (Wisetack, Hearth, GreenSky or another) and its customers see "Apply
-- for financing" on their estimates and contracts in the portal. The lender takes the application and decides; the CRM
-- states no rate or payment.
--
--   * company_profile.financing_provider: the lender's name, as the
--     customer reads it.
--   * company_profile.financing_url: the application link. Only an https
--     address, whatever writes it.
--
-- Two columns are added, nothing is removed: the running code reads them
-- on their own and shows no offer without them. Run in the Supabase SQL
-- editor. Safe to run twice.

begin;

alter table public.company_profile
  add column if not exists financing_provider text,
  add column if not exists financing_url text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'company_profile_financing_url_check') then
    alter table public.company_profile
      add constraint company_profile_financing_url_check
      check (financing_url is null or (financing_url ~ '^https://' and length(financing_url) <= 500));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'company_profile_financing_provider_check') then
    alter table public.company_profile
      add constraint company_profile_financing_provider_check
      check (financing_provider is null or length(financing_provider) <= 60);
  end if;
end
$$;

comment on column public.company_profile.financing_provider is
  'The lender customers apply to for financing (DECISIONS #161).';
comment on column public.company_profile.financing_url is
  'The lender''s application link for this company; customers see Apply for financing.';

commit;

-- Check: should read true.
select
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'company_profile' and column_name = 'financing_url')
  as customer_financing_ready;
