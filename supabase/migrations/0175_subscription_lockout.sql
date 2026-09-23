-- AI Build Pro subscriptions: lock a company out when its subscription
-- lapses.
--
-- Self-serve signup (0130) sells the CRM on a recurring Stripe price, but
-- until now only the first payment was ever looked at. A company that
-- cancelled, or whose card kept declining, kept full access. This adds:
--
--   1. company_billing -- one row per subscribed company: its Stripe
--      customer, the subscription that speaks for it, and that
--      subscription's status. Written only by the server (the Stripe
--      webhook, signup, the lock screen). It is its own table rather than
--      columns on companies because companies_update lets a company's own
--      Admin edit that row, and they must not be able to un-lapse
--      themselves.
--
--   2. A restrictive row-level policy, billing_lock, on every tenant
--      table with a company_id. Restrictive policies are ANDed with the
--      existing ones, so nothing anyone can see today changes -- except
--      that a lapsed company's rows disappear for its members. The app
--      shows those members a lock screen; this is what makes it true
--      for a direct API call too.
--
-- Companies with no company_billing row (everything made before signup
-- existed, and every manual invite) are never locked. Platform admins are
-- never locked out of anything.
--
-- Safe to run twice: every statement is create-or-replace, if-not-exists,
-- or drop-then-create.
begin;

create table if not exists public.company_billing (
  company_id uuid primary key references public.companies (id) on delete cascade,
  stripe_customer_id text not null,
  stripe_subscription_id text,
  -- Stripe's own subscription status, verbatim: active, trialing,
  -- past_due, canceled, unpaid, incomplete, incomplete_expired, paused.
  billing_status text,
  updated_at timestamptz not null default now()
);

create index if not exists company_billing_customer_idx
  on public.company_billing (stripe_customer_id);

-- Members may read their own company's status. No insert/update/delete
-- policies at all: only the service-role client writes here.
alter table public.company_billing enable row level security;
drop policy if exists company_billing_select on public.company_billing;
create policy company_billing_select on public.company_billing for select
  to authenticated
  using (company_id in (select public.current_member_company_ids()));

-- Companies bought before this migration: their Stripe customer was kept
-- on the signup invite. Their status fills in at the next billing event
-- or the next time someone lands on the lock screen.
insert into public.company_billing (company_id, stripe_customer_id, stripe_subscription_id)
select distinct on (si.company_id) si.company_id, si.stripe_customer_id, si.stripe_subscription_id
from public.signup_invites si
where si.company_id is not null
  and si.stripe_customer_id is not null
order by si.company_id, si.created_at desc
on conflict (company_id) do nothing;

-- The lapsed companies, as seen by the caller. Empty for platform admins.
-- Takes no column argument, so a policy calling it through (select ...)
-- runs it once per query rather than once per row (see 0108). The status
-- list must match LOCKED_STATUSES in src/lib/billing/subscription.ts.
create or replace function public.billing_locked_company_ids()
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select cb.company_id
  from public.company_billing cb
  where cb.billing_status in ('canceled', 'unpaid', 'incomplete_expired', 'paused')
    and not exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.is_platform_admin
    )
$$;

-- Puts billing_lock on every RLS-protected public table with a uuid
-- company_id. A function rather than a one-off loop so a later migration
-- that adds a tenant table can simply `select public.apply_billing_lock_policies();`.
-- Left alone: the tables the lock screen itself needs to recognise who
-- is signed in and which company they are in, and company_billing.
create or replace function public.apply_billing_lock_policies()
returns void
language plpgsql
set search_path to 'public'
as $$
declare
  t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a
      on a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relrowsecurity
      and a.atttypid = 'uuid'::regtype
      and c.relname not in ('company_members', 'profiles', 'company_billing', 'signup_invites')
  loop
    execute format('drop policy if exists billing_lock on public.%I', t.relname);
    execute format(
      'create policy billing_lock on public.%I as restrictive for all to authenticated '
      'using (company_id is null or company_id not in (select public.billing_locked_company_ids())) '
      'with check (company_id is null or company_id not in (select public.billing_locked_company_ids()))',
      t.relname
    );
  end loop;
end
$$;

select public.apply_billing_lock_policies();

commit;
