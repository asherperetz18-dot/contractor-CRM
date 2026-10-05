-- Monthly limits per company (DECISIONS #133).
--
-- How many AI answers, texts and emails a company may use each month.
-- Empty (null) means no limit, which is every company until a platform
-- admin sets one on Platform Admin › Companies. Checked against this
-- month's counts (company_usage, 0199) before each one goes out.
--
-- The company's own people can read their limits (Settings shows them);
-- only the server writes them, for a platform admin.
--
-- Until this runs, there are no limits. Safe to run twice.

begin;

create table if not exists public.company_limits (
  company_id uuid primary key references public.companies (id) on delete cascade,
  ai_requests_per_month integer check (ai_requests_per_month >= 0),
  sms_per_month integer check (sms_per_month >= 0),
  emails_per_month integer check (emails_per_month >= 0),
  updated_at timestamptz not null default now(),
  -- Who set them last; no foreign key, so removing the person keeps the record.
  updated_by uuid
);

alter table public.company_limits enable row level security;
drop policy if exists company_limits_select on public.company_limits;
create policy company_limits_select on public.company_limits for select
  to authenticated
  using (company_id in (select public.current_member_company_ids()));

-- Every company table carries the subscription lock (0175).
select public.apply_billing_lock_policies();

commit;

-- Check: should read true.
select exists (
  select 1 from information_schema.tables
  where table_schema = 'public' and table_name = 'company_limits'
) as company_limits_ready;
