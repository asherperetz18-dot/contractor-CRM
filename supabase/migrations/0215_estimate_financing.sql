-- 0215: financing on an estimate, step by step (DECISIONS #162).
--
-- With a company's lender link in place (0214), the office sends the
-- customer the link from the estimate and keeps track of where the
-- application stands: link sent, applied, approved, declined, funded.
-- By hand -- nothing comes back from the lender yet.
--
--   * estimate_financing_events: one row per step, never changed or
--     removed by people; the newest is where it stands. Who, when, an
--     approved amount, a note, and for a sent link how it went.
--     The company's people can read it; only the server writes it.
--
-- A table is added, nothing is removed: the running code reads it on its
-- own and shows no history without it. Run in the Supabase SQL editor.
-- Safe to run twice.

begin;

create table if not exists public.estimate_financing_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  estimate_id uuid not null references public.estimates (id) on delete cascade,
  status text not null check (status in ('sent', 'applied', 'approved', 'declined', 'funded')),
  -- What the lender approved or paid out, when the office knows it.
  amount_cents bigint check (amount_cents is null or (amount_cents > 0 and amount_cents <= 10000000000)),
  note text check (note is null or length(note) <= 500),
  -- How a sent link went.
  channel text check (channel is null or channel in ('text', 'email', 'both')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.estimate_financing_events is
  'Where an estimate''s financing stands, step by step (DECISIONS #162). The newest row is the current status.';

create index if not exists estimate_financing_events_estimate_idx
  on public.estimate_financing_events (company_id, estimate_id, created_at);

alter table public.estimate_financing_events enable row level security;
drop policy if exists estimate_financing_events_select on public.estimate_financing_events;
create policy estimate_financing_events_select on public.estimate_financing_events for select
  to authenticated
  using (company_id in (select public.current_member_company_ids()));

-- Every company table carries the subscription lock (0175).
select public.apply_billing_lock_policies();

commit;

-- Check: should read true.
select
  exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'estimate_financing_events')
  as estimate_financing_ready;
