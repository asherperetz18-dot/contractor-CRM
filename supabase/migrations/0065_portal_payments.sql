begin;

-- Online payments taken through the client portal.
--
-- Only a record of what happened; no card data is stored or ever reaches
-- this application. Payment is taken on Stripe's own hosted Checkout
-- page, so this app stays entirely outside PCI scope -- the customer
-- leaves for Stripe and comes back with a result.
create table portal_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  estimate_id uuid not null references estimates(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,

  -- Only deposits for now. Progress payments need a way to mark a phase
  -- due, which is really the start of invoicing.
  kind text not null default 'deposit' check (kind in ('deposit', 'progress')),
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null default 'usd',

  status text not null default 'pending'
    check (status in ('pending', 'succeeded', 'failed', 'cancelled')),
  -- 'card' or 'us_bank_account', as Stripe reports it after the fact.
  method text,

  -- Unique so a webhook delivered twice cannot record the money twice.
  -- Stripe retries on any non-2xx, so duplicate delivery is normal rather
  -- than exceptional.
  stripe_session_id text unique,
  stripe_payment_intent_id text,

  paid_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index portal_payments_estimate_idx on portal_payments (estimate_id, created_at desc);
create index portal_payments_company_idx on portal_payments (company_id, created_at desc);

alter table portal_payments enable row level security;

-- Staff read only. Every write comes from the portal or the Stripe
-- webhook, both of which run through the service role after validating
-- either a portal session or a signed Stripe event -- neither is an
-- authenticated Supabase user, so no write policy exists at all.
create policy "portal_payments_select" on portal_payments for select
  to authenticated using (
    is_member_of_company(company_id)
    and can_view_estimates_in_company(company_id)
    and estimate_visible_to_current_user(estimate_id)
  );

commit;
