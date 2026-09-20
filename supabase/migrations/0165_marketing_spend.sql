-- Marketing spend by source, and which sources are bought lists.
--
-- The only cost Marketing Analytics could show was leads.lead_cost,
-- which migration 0089 stamps with the company default ($375) on every
-- new lead -- so "cost per lead" read $375 on 96% of the book and
-- measured nothing, and cost per sale was built on a placeholder.
--
--   marketing_spend      one row per source per month: what was actually
--                        paid for that source (the vendor's invoice, the
--                        month's ad budget), in integer cents. A report
--                        window claims each month in proportion to the
--                        days it covers (src/lib/data/marketing-spend.ts).
--   lead_sources.bought_list
--                        a source that is a purchased contact list rather
--                        than an inbound channel. The analytics page can
--                        switch these off in one click, so a 2,871-lead
--                        cold list stops sitting in the same denominator
--                        as Google Guarantee.
--
-- RLS: every active member of the company can read spend (the page that
-- shows cost per lead is already visible to them); only Office/Admin
-- write it, the same people who manage the source list. Idempotent;
-- safe as one paste and safe to run twice.

begin;

alter table public.lead_sources
  add column if not exists bought_list boolean not null default false;

comment on column public.lead_sources.bought_list is
  'A purchased contact list rather than an inbound channel (0165). Marketing Analytics can exclude these sources in one click.';

create table if not exists public.marketing_spend (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  source text not null,
  month date not null,
  amount_cents integer not null default 0,
  note text,
  updated_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketing_spend_month_is_first check (extract(day from month) = 1),
  constraint marketing_spend_amount_nonneg check (amount_cents >= 0),
  constraint marketing_spend_company_source_month_key unique (company_id, source, month)
);

comment on table public.marketing_spend is
  'What a company paid for a lead source in a calendar month, in cents (0165). Read by Marketing Analytics for real cost per lead and per sale.';

create index if not exists marketing_spend_company_month_idx
  on public.marketing_spend (company_id, month);

alter table public.marketing_spend enable row level security;

drop policy if exists "marketing_spend_select" on public.marketing_spend;
create policy "marketing_spend_select" on public.marketing_spend for select
  to authenticated
  using (company_id in (select public.current_member_company_ids()));

drop policy if exists "marketing_spend_write" on public.marketing_spend;
create policy "marketing_spend_write" on public.marketing_spend for all
  to authenticated
  using (company_id in (select public.current_role_company_ids('Office'::app_role)))
  with check (company_id in (select public.current_role_company_ids('Office'::app_role)));

commit;

-- Verify: the table has RLS on with two policies, and the column exists.
-- Expect: rls_enabled = true, policies = 2, bought_list = 1.
select
  (select relrowsecurity from pg_class where relname = 'marketing_spend') as rls_enabled,
  (select count(*) from pg_policy where polrelid = 'public.marketing_spend'::regclass) as policies,
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'lead_sources' and column_name = 'bought_list') as bought_list;
