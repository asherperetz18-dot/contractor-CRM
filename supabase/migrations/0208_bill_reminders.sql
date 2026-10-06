-- 0208: automatic payment reminders (DECISIONS #152).
--
-- Step 4 of full invoicing. A company can switch on reminders for the
-- bills its customers still owe (invoices, and billed stages of a
-- contract): 3 days before the due date, on the day, then once a week
-- after, up to three times. Off for every company until it's switched on
-- under Settings > Payment Reminders. They go by email unless the
-- company picks text, or both. They stop the moment the bill is paid.
--
--   * company_profile.bill_reminders_enabled / bill_reminder_channel:
--     the company's choice.
--   * estimate_payments.reminders_paused: the office stopped reminders
--     on one bill (a payment plan, a dispute).
--   * bill_reminders: one row per reminder sent, at most one per bill
--     and step -- the job claims the row before sending, so a step can't
--     go twice. The company's people can read it; only the server writes.
--   * the job itself, every hour; it sends only between 9am and 6pm on
--     each company's own clock.
--
-- Columns and a table are added, nothing is removed: the running code
-- ignores them. Run in the Supabase SQL editor. Safe to run twice.

begin;

alter table public.company_profile
  add column if not exists bill_reminders_enabled boolean not null default false;
alter table public.company_profile
  add column if not exists bill_reminder_channel text not null default 'email'
    check (bill_reminder_channel in ('email', 'text', 'both'));

comment on column public.company_profile.bill_reminders_enabled is
  'Send customers automatic payment reminders (DECISIONS #152). Off until switched on.';
comment on column public.company_profile.bill_reminder_channel is
  'How reminders go: email, text or both.';

alter table public.estimate_payments
  add column if not exists reminders_paused boolean not null default false;

comment on column public.estimate_payments.reminders_paused is
  'The office stopped automatic reminders on this bill.';

create table if not exists public.bill_reminders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  estimate_payment_id uuid not null references public.estimate_payments (id) on delete cascade,
  -- before: 3 days before it's due; due: on the day; late1-3: each week after.
  kind text not null check (kind in ('before', 'due', 'late1', 'late2', 'late3')),
  sent_at timestamptz not null default now(),
  sent_via text check (sent_via is null or sent_via in ('text', 'email', 'text+email')),
  unique (estimate_payment_id, kind)
);

create index if not exists bill_reminders_company_idx
  on public.bill_reminders (company_id, estimate_payment_id);

alter table public.bill_reminders enable row level security;
drop policy if exists bill_reminders_select on public.bill_reminders;
create policy bill_reminders_select on public.bill_reminders for select
  to authenticated
  using (company_id in (select public.current_member_company_ids()));

-- Every company table carries the subscription lock (0175).
select public.apply_billing_lock_policies();

-- Every hour, at 25 past (UTC). Where the scheduler (0203) isn't set up,
-- this is skipped and the rest still applies.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron')
     and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'crm_jobs' and p.proname = 'run') then
    perform cron.schedule('crm-bill-reminders', '25 * * * *', $job$select crm_jobs.run('/api/cron/bill-reminders')$job$);
  end if;
end
$$;

commit;

-- Check: should read true.
select
  (select count(*) from information_schema.columns
    where table_schema = 'public'
      and ((table_name = 'company_profile' and column_name in ('bill_reminders_enabled', 'bill_reminder_channel'))
        or (table_name = 'estimate_payments' and column_name = 'reminders_paused'))) = 3
  and exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'bill_reminders')
  as bill_reminders_ready;

-- And the job is on the schedule: should read 1.
select count(*) as bill_reminders_job from cron.job where jobname = 'crm-bill-reminders' and active;
