-- Company words (DECISIONS #121).
--
-- Each company can choose its own word for eight things its customers
-- read about: estimate, project, appointment, contract, rep, customer,
-- change order and deposit (a plumber's "Quote" for a "Job", say). Set in
-- Settings › Company Words. Only the words a company changed are stored,
-- e.g. {"estimate": {"one": "Quote", "many": "Quotes"}}; anything missing
-- reads as the standard word (src/lib/company-words.ts).
--
-- Until this runs, every company uses the standard words and the
-- settings page says so. Safe to run twice.

alter table public.company_profile
  add column if not exists wording jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'company_profile_wording_is_object') then
    alter table public.company_profile
      add constraint company_profile_wording_is_object check (jsonb_typeof(wording) = 'object');
  end if;
end
$$;

-- Check: should read true.
select exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'company_profile' and column_name = 'wording'
) as company_words_ready;
