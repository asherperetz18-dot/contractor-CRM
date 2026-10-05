-- What each company uses each month (DECISIONS #132).
--
-- One row per company per month: AI requests and their size (the words
-- the AI read and wrote), texts sent and emails sent. Counted by the
-- server where each one happens; shown on Platform Admin › Companies and
-- in the company's own Settings › Subscription. The monthly limits come
-- next, on top of these counts.
--
-- The company's own people can read their rows; nobody signed in can
-- write them -- only the server, through record_company_usage.
--
-- Until this runs, nothing is counted and everything works as before.
-- Safe to run twice.

begin;

create table if not exists public.company_usage (
  company_id uuid not null references public.companies (id) on delete cascade,
  -- The month's first day, in UTC.
  month date not null,
  ai_requests integer not null default 0,
  ai_input_tokens bigint not null default 0,
  ai_output_tokens bigint not null default 0,
  sms_sent integer not null default 0,
  emails_sent integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (company_id, month)
);

create index if not exists company_usage_month_idx on public.company_usage (month);

alter table public.company_usage enable row level security;
drop policy if exists company_usage_select on public.company_usage;
create policy company_usage_select on public.company_usage for select
  to authenticated
  using (company_id in (select public.current_member_company_ids()));

-- Adds to this month's counts in one statement, so two requests at the
-- same moment both count.
create or replace function public.record_company_usage(
  p_company_id uuid,
  p_ai_requests integer default 0,
  p_ai_input_tokens bigint default 0,
  p_ai_output_tokens bigint default 0,
  p_sms_sent integer default 0,
  p_emails_sent integer default 0
)
returns void
language sql
set search_path to 'public'
as $$
  insert into public.company_usage as u
    (company_id, month, ai_requests, ai_input_tokens, ai_output_tokens, sms_sent, emails_sent)
  values
    (p_company_id, (date_trunc('month', now() at time zone 'utc'))::date,
     p_ai_requests, p_ai_input_tokens, p_ai_output_tokens, p_sms_sent, p_emails_sent)
  on conflict (company_id, month) do update set
    ai_requests = u.ai_requests + excluded.ai_requests,
    ai_input_tokens = u.ai_input_tokens + excluded.ai_input_tokens,
    ai_output_tokens = u.ai_output_tokens + excluded.ai_output_tokens,
    sms_sent = u.sms_sent + excluded.sms_sent,
    emails_sent = u.emails_sent + excluded.emails_sent,
    updated_at = now();
$$;

-- The server only: a company must not be able to rewrite its own counts.
revoke execute on function public.record_company_usage(uuid, integer, bigint, bigint, integer, integer)
  from public, anon, authenticated;
grant execute on function public.record_company_usage(uuid, integer, bigint, bigint, integer, integer)
  to service_role;

-- Every company table carries the subscription lock (0175).
select public.apply_billing_lock_policies();

commit;

-- Check: should read true.
select exists (
  select 1 from information_schema.tables
  where table_schema = 'public' and table_name = 'company_usage'
) as company_usage_ready;
