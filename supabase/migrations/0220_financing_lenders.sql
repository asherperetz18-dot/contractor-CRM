-- 0220: several financing lenders (DECISIONS #170).
--
-- A company can work with more than one lender (Service Finance and
-- Synchrony, say). It lists them in the order it wants them tried; each
-- customer is offered one at a time, and a lender that says no can be
-- swapped for the next.
--
--   * financing_lenders: one row per lender -- the name customers see,
--     the customer application link, the company's fee (hundredths of a
--     percent of the amount financed, as 0219), whether it's on, and its
--     place in the order. The company's people can read it; only the
--     server writes it, after checking the role.
--   * estimates.financing_lender_id: which of them an estimate is with;
--     none means the first that's on.
--   * The lender a company already has (company_profile, 0214) and its fee
--     (0219) are copied in as its first lender, once. company_profile
--     keeps them; nothing reads them once this has run.
--
-- A table and a column are added, nothing is removed: until this runs,
-- the running code uses company_profile's lender as before. Run in the
-- Supabase SQL editor. Safe to run twice.

begin;

create table if not exists public.financing_lenders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  apply_url text not null check (apply_url ~* '^https://' and length(apply_url) <= 500),
  fee_bp integer check (fee_bp is null or fee_bp between 0 and 5000),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.financing_lenders is
  'The lenders a company offers its customers financing through, in the order they''re tried (DECISIONS #170).';

create index if not exists financing_lenders_company_idx
  on public.financing_lenders (company_id, sort_order);

alter table public.financing_lenders enable row level security;
drop policy if exists financing_lenders_select on public.financing_lenders;
create policy financing_lenders_select on public.financing_lenders for select
  to authenticated
  using (company_id in (select public.current_member_company_ids()));

alter table public.estimates
  add column if not exists financing_lender_id uuid references public.financing_lenders (id) on delete set null;

comment on column public.estimates.financing_lender_id is
  'Which of the company''s lenders this estimate is with (DECISIONS #170); null means the first that''s on.';

-- The lender each company already has, with its fee, as its first.
insert into public.financing_lenders (company_id, name, apply_url, fee_bp, sort_order)
select cp.company_id, trim(cp.financing_provider), trim(cp.financing_url), cp.financing_fee_bp, 0
  from public.company_profile cp
 where length(trim(coalesce(cp.financing_provider, ''))) between 1 and 60
   and trim(coalesce(cp.financing_url, '')) ~* '^https://'
   and length(trim(cp.financing_url)) <= 500
   and not exists (select 1 from public.financing_lenders l where l.company_id = cp.company_id);

-- Every company table carries the subscription lock (0175).
select public.apply_billing_lock_policies();

commit;

-- Check: should read true.
select
  exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'financing_lenders')
  and exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'estimates' and column_name = 'financing_lender_id'
  )
  as financing_lenders_ready;
