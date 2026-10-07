-- 0221: connecting QuickBooks Online, step 1 (DECISIONS #172).
--
-- Each company connects its own QuickBooks Online through Intuit's
-- sign-in, then matches its accounts to QuickBooks' -- the "paid from"
-- accounts (payment_accounts.qb_account_id, from 0176) and its job cost
-- categories. Nothing is written to QuickBooks in this step.
--
--   * quickbooks_connections: one per company. Which QuickBooks company
--     (realm) it's connected to, its name, and the login Intuit gave --
--     encrypted by the server (the key lives only there), like the
--     Stripe and Twilio keys. Also the list of QuickBooks accounts as last
--     read, so the settings page can show names without asking Intuit.
--     RLS on, no policies, and no rights for anon/authenticated: no CRM
--     user can read it, only the server.
--   * quickbooks_expense_accounts: the QuickBooks account each cost
--     category lands in; category_key '' is the default for everything
--     else. The company's people can read it; only the server writes it.
--
-- Tables are added, nothing is removed. Run in the Supabase SQL editor.
-- Safe to run twice.

begin;

create table if not exists public.quickbooks_connections (
  company_id uuid primary key references public.companies (id) on delete cascade,
  realm_id text,
  company_name text,
  environment text not null default 'sandbox' check (environment in ('sandbox', 'production')),
  access_token_enc text,
  refresh_token_enc text,
  access_expires_at timestamptz,
  refresh_expires_at timestamptz,
  -- QuickBooks' accounts as last read: [{ "id", "name", "type" }].
  accounts jsonb not null default '[]'::jsonb,
  accounts_read_at timestamptz,
  connected_by uuid references public.profiles (id) on delete set null,
  connected_at timestamptz,
  -- Set by Disconnect; the realm stays, so reconnecting to the same
  -- QuickBooks company keeps the matches.
  disconnected_at timestamptz,
  -- Why the last call to QuickBooks failed, shown on the settings page.
  last_error text,
  updated_at timestamptz not null default now()
);

comment on table public.quickbooks_connections is
  'Each company''s QuickBooks Online connection (DECISIONS #172). Tokens encrypted; server only.';

alter table public.quickbooks_connections enable row level security;
revoke all on public.quickbooks_connections from anon, authenticated;

create table if not exists public.quickbooks_expense_accounts (
  company_id uuid not null references public.companies (id) on delete cascade,
  -- The category as matched: trimmed and lower case; '' for the default.
  category_key text not null,
  -- As the company writes it, for the page.
  category text not null default '',
  qb_account_id text not null,
  updated_at timestamptz not null default now(),
  primary key (company_id, category_key)
);

comment on table public.quickbooks_expense_accounts is
  'The QuickBooks account each job cost category lands in (DECISIONS #172); category_key '''' is the default.';

alter table public.quickbooks_expense_accounts enable row level security;
drop policy if exists quickbooks_expense_accounts_select on public.quickbooks_expense_accounts;
create policy quickbooks_expense_accounts_select on public.quickbooks_expense_accounts for select
  to authenticated
  using (company_id in (select public.current_member_company_ids()));

-- Every company table carries the subscription lock (0175).
select public.apply_billing_lock_policies();

commit;

-- Check: should read true.
select
  exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'quickbooks_connections')
  and exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'quickbooks_expense_accounts')
  as quickbooks_ready;
