-- 0209: credits on bills (DECISIONS #154).
--
-- Step 6 of full invoicing, part one. A credit lowers what a customer
-- owes on a bill without money moving: a discount after the fact,
-- goodwill, or -- with refunds, next -- what's left when money goes back
-- and the customer no longer owes it. The bill's own amount never
-- changes: it's what the customer signed or was sent, and the signed
-- contract prints it. The credit sits beside it.
--
--   * estimate_payments.credit_cents: the total credited on a bill.
--     What is owed on it is its amount, less its credits, less the money
--     settled on it.
--   * bill_credits: one row per credit -- how much, why, who, when.
--     The company's people can read it; only the server writes it.
--   * give_bill_credit: gives one, checked and written together: a
--     billed bill on a signed contract or an issued invoice, never more
--     than is still owed on it. The server only.
--   * dashboard_rollup: its owed figures take credits off too (the
--     0195 definition, with that one change).
--
-- Columns, a table and functions are added; nothing is removed, and the
-- running code reads bills in a way that works with or without this.
-- Run in the Supabase SQL editor. Safe to run twice.

begin;

alter table public.estimate_payments
  add column if not exists credit_cents bigint not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'estimate_payments_credit_cents_check') then
    alter table public.estimate_payments
      add constraint estimate_payments_credit_cents_check check (credit_cents >= 0);
  end if;
end
$$;

comment on column public.estimate_payments.credit_cents is
  'Credited off what is owed on this bill (DECISIONS #154). The amount itself never changes.';

create table if not exists public.bill_credits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  estimate_id uuid not null references public.estimates (id) on delete cascade,
  estimate_payment_id uuid not null references public.estimate_payments (id) on delete cascade,
  amount_cents bigint not null check (amount_cents > 0),
  reason text not null check (length(trim(reason)) > 0),
  -- The refund it goes with, when money went back too (step 6, part two).
  refund_payment_id uuid references public.portal_payments (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists bill_credits_company_idx on public.bill_credits (company_id, estimate_id);
create index if not exists bill_credits_payment_idx on public.bill_credits (estimate_payment_id);

alter table public.bill_credits enable row level security;
drop policy if exists bill_credits_select on public.bill_credits;
create policy bill_credits_select on public.bill_credits for select
  to authenticated
  using (company_id in (select public.current_member_company_ids()));

-- Gives one credit: the bill locked while it's checked, the record and
-- the bill's total written together. Never more than is still owed --
-- the bill's amount, less its credits, less the money settled on it and
-- the money on its way (a checkout opened and left is not money).
create or replace function public.give_bill_credit(
  p_company uuid,
  p_phase uuid,
  p_amount bigint,
  p_reason text,
  p_by uuid,
  p_refund uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phase record;
  v_status text;
  v_paid bigint;
  v_owed bigint;
  v_id uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount greater than zero.' using errcode = 'check_violation';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Say why the credit is given.' using errcode = 'check_violation';
  end if;

  select ph.id, ph.estimate_id, ph.amount_cents, ph.credit_cents, ph.requested_at, ph.cancelled_at
    into v_phase
    from public.estimate_payments ph
   where ph.id = p_phase and ph.company_id = p_company
   for update;
  if not found then
    raise exception 'That bill no longer exists.' using errcode = 'no_data_found';
  end if;

  select e.status into v_status
    from public.estimates e
   where e.id = v_phase.estimate_id and e.company_id = p_company;
  if v_status is distinct from 'Signed' then
    raise exception 'Only a bill on a signed contract or an issued invoice can be credited.' using errcode = 'check_violation';
  end if;
  if v_phase.requested_at is null or v_phase.cancelled_at is not null then
    raise exception 'Only a bill that has been billed can be credited.' using errcode = 'check_violation';
  end if;

  select coalesce(sum(pp.amount_cents) filter (
           where pp.status = 'succeeded'
              or (pp.status = 'pending' and not (pp.stripe_session_id is not null and pp.stripe_payment_intent_id is null))
         ), 0)
    into v_paid
    from public.portal_payments pp
   where pp.estimate_payment_id = p_phase;

  v_owed := greatest(0, v_phase.amount_cents - v_phase.credit_cents - v_paid);
  if p_amount > v_owed then
    raise exception 'That is more than is still owed on this bill.' using errcode = 'check_violation';
  end if;

  insert into public.bill_credits (company_id, estimate_id, estimate_payment_id, amount_cents, reason, refund_payment_id, created_by)
  values (p_company, v_phase.estimate_id, p_phase, p_amount, trim(p_reason), p_refund, p_by)
  returning id into v_id;

  update public.estimate_payments
     set credit_cents = credit_cents + p_amount,
         updated_at = now()
   where id = p_phase;

  return v_id;
end
$$;

revoke all on function public.give_bill_credit(uuid, uuid, bigint, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.give_bill_credit(uuid, uuid, bigint, text, uuid, uuid) to service_role;

-- Every company table carries the subscription lock (0175).
select public.apply_billing_lock_policies();

-- The dashboard: the 0195 definition, its owed figures less credits.
CREATE OR REPLACE FUNCTION public.dashboard_rollup(p_company uuid, p_from date, p_to date, p_prev_from date, p_prev_to date, p_months_from date, p_today date, p_d30 date, p_d60 date, p_d90 date, p_calls_from date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with
cohort as (
  select id, stage, value, has_appt,
         coalesce(nullif(source, ''), 'Unknown') as source
  from leads
  where company_id = p_company
    and (p_from is null or (created_at at time zone 'utc')::date >= p_from)
    and (p_to is null or (created_at at time zone 'utc')::date <= p_to)
),
cohort_est as (
  select e.lead_id,
         bool_or(e.status <> 'Draft') as saw,
         coalesce(sum(e.total_cents) filter (where e.status = 'Signed'), 0) as signed_cents
  from estimates e
  join cohort c on c.id = e.lead_id
  where e.company_id = p_company
    and coalesce(e.kind, 'contract') = 'contract'
  group by e.lead_id
),
sales as (
  select id as sale_id, assigned_to,
         sales_rep_1, sales_rep_1_bp, sales_rep_2, sales_rep_2_bp,
         (signed_at at time zone 'utc')::date as signed_day,
         to_char(signed_at at time zone 'utc', 'YYYY-MM') as signed_month,
         total_cents
  from estimates
  where company_id = p_company
    and status = 'Signed'
    and coalesce(kind, 'contract') = 'contract'
    and signed_at is not null
),
-- Who each sale counts for on the team panel: the Sales team seats with
-- a share, dollars split by share; seats without a share fall to seat
-- one; no seats falls to the stamped rep (src/lib/data/sale-credit.ts).
sale_seats as (
  select sale_id, sales_rep_1 as rep, coalesce(sales_rep_1_bp, 10000) as bp, 1 as ord
  from sales where sales_rep_1 is not null
  union all
  select sale_id, sales_rep_2, coalesce(sales_rep_2_bp, 0), 2
  from sales where sales_rep_2 is not null
),
sale_credits as (
  select s.sale_id, s.signed_day, x.rep,
         round(s.total_cents * x.bp / 10000.0)::bigint as cents
  from sales s
  join sale_seats x on x.sale_id = s.sale_id and x.bp > 0
  union all
  select s.sale_id, s.signed_day,
         (select x.rep from sale_seats x where x.sale_id = s.sale_id order by x.ord limit 1),
         s.total_cents
  from sales s
  where exists (select 1 from sale_seats x where x.sale_id = s.sale_id)
    and not exists (select 1 from sale_seats x where x.sale_id = s.sale_id and x.bp > 0)
  union all
  select s.sale_id, s.signed_day, s.assigned_to, s.total_cents
  from sales s
  where s.assigned_to is not null
    and not exists (select 1 from sale_seats x where x.sale_id = s.sale_id)
),
pays as (
  select amount_cents,
         (coalesce(paid_at, created_at) at time zone 'utc')::date as pay_day,
         to_char(coalesce(paid_at, created_at) at time zone 'utc', 'YYYY-MM') as pay_month
  from portal_payments
  where company_id = p_company and status = 'succeeded'
),
win_events as (
  select assigned_to
  from events
  where company_id = p_company
    and (p_from is null or date >= p_from)
    and (p_to is null or date <= p_to)
),
phases as (
  -- What each bill asks once its credits are off (0209, DECISIONS #154).
  select ph.id, ph.amount_cents - ph.credit_cents as amount_cents, ph.credit_cents, ph.due_date,
         coalesce(sum(pp.amount_cents) filter (where pp.status = 'succeeded'), 0) as settled,
         coalesce(sum(pp.amount_cents) filter (where pp.status = 'pending'), 0) as pending,
         coalesce(bool_or(pp.status = 'succeeded'), false) as any_succeeded
  from estimate_payments ph
  join estimates e on e.id = ph.estimate_id and e.status = 'Signed'
  left join portal_payments pp on pp.estimate_payment_id = ph.id
  where ph.company_id = p_company and ph.requested_at is not null
  group by ph.id, ph.amount_cents, ph.credit_cents, ph.due_date
),
phase_rows as (
  select greatest(0, amount_cents - settled) as owed,
         case
           when (any_succeeded or credit_cents > 0) and settled >= amount_cents then 'paid'
           when pending > 0 and settled + pending >= amount_cents then 'clearing'
           when due_date is not null and due_date < p_today then 'overdue'
           when settled > 0 then 'partial'
           else 'billed'
         end as state,
         case when due_date is not null then p_today - due_date else 0 end as late
  from phases
),
open_leads as (
  select stage::text as stage, value,
         (updated_at at time zone 'utc')::date as touch
  from leads
  where company_id = p_company
    and not public.is_closed_stage(stage_key)
)
select jsonb_build_object(
  'attention', jsonb_build_object(
    'overdueTasks', (
      select count(*) from lead_tasks
      where company_id = p_company and completed_at is null and due_date < p_today
    ),
    'apptsToday', (
      select count(*) from events where company_id = p_company and date = p_today
    ),
    'awaitingCount', (
      select count(*) from estimates
      where company_id = p_company and status in ('Sent', 'Viewed')
        and coalesce(kind, 'contract') = 'contract'
    ),
    'awaitingCents', (
      select coalesce(sum(total_cents), 0) from estimates
      where company_id = p_company and status in ('Sent', 'Viewed')
        and coalesce(kind, 'contract') = 'contract'
    ),
    'overdueOwedCents', (
      select coalesce(sum(owed), 0) from phase_rows where state = 'overdue' and owed > 0
    ),
    'overdueOwedCount', (
      select count(*) from phase_rows where state = 'overdue' and owed > 0
    )
  ),
  'window', jsonb_build_object(
    'leads', (select count(*) from cohort),
    'appts', (select count(*) from win_events),
    'signedCount', (
      select count(*) from sales
      where (p_from is null or signed_day >= p_from) and (p_to is null or signed_day <= p_to)
    ),
    'signedCents', (
      select coalesce(sum(total_cents), 0) from sales
      where (p_from is null or signed_day >= p_from) and (p_to is null or signed_day <= p_to)
    ),
    'collectedCents', (
      select coalesce(sum(amount_cents), 0) from pays
      where (p_from is null or pay_day >= p_from) and (p_to is null or pay_day <= p_to)
    )
  ),
  'prev', jsonb_build_object(
    'leads', (
      select count(*) from leads
      where company_id = p_company and p_prev_from is not null
        and (created_at at time zone 'utc')::date between p_prev_from and p_prev_to
    ),
    'appts', (
      select count(*) from events
      where company_id = p_company and p_prev_from is not null
        and date between p_prev_from and p_prev_to
    ),
    'signedCount', (
      select count(*) from sales
      where p_prev_from is not null and signed_day between p_prev_from and p_prev_to
    ),
    'signedCents', (
      select coalesce(sum(total_cents), 0) from sales
      where p_prev_from is not null and signed_day between p_prev_from and p_prev_to
    ),
    'collectedCents', (
      select coalesce(sum(amount_cents), 0) from pays
      where p_prev_from is not null and pay_day between p_prev_from and p_prev_to
    )
  ),
  'months', (
    select jsonb_agg(
      jsonb_build_object(
        'month', to_char(m.d, 'YYYY-MM'),
        'signedCents', coalesce(s.cents, 0),
        'collectedCents', coalesce(p.cents, 0)
      ) order by m.d
    )
    from generate_series(p_months_from, p_months_from + interval '11 months', interval '1 month') as m(d)
    left join (select signed_month, sum(total_cents) as cents from sales group by 1) s
      on s.signed_month = to_char(m.d, 'YYYY-MM')
    left join (select pay_month, sum(amount_cents) as cents from pays group by 1) p
      on p.pay_month = to_char(m.d, 'YYYY-MM')
  ),
  'funnel', jsonb_build_object(
    'leads', (select count(*) from cohort),
    'withAppt', (select count(*) from cohort where has_appt),
    'estimated', (
      select count(*) from cohort c join cohort_est ce on ce.lead_id = c.id where ce.saw
    ),
    'signed', (
      select count(*) from cohort c join cohort_est ce on ce.lead_id = c.id
      where ce.signed_cents > 0
    )
  ),
  'stages', (
    select coalesce(jsonb_agg(row order by stage), '[]'::jsonb)
    from (
      select stage,
        jsonb_build_object(
          'stage', stage,
          'buckets', jsonb_build_object(
            'd30', jsonb_build_object(
              'count', count(*) filter (where touch >= p_d30),
              'value', coalesce(sum(value) filter (where touch >= p_d30), 0)
            ),
            'd60', jsonb_build_object(
              'count', count(*) filter (where touch >= p_d60),
              'value', coalesce(sum(value) filter (where touch >= p_d60), 0)
            ),
            'd90', jsonb_build_object(
              'count', count(*) filter (where touch >= p_d90),
              'value', coalesce(sum(value) filter (where touch >= p_d90), 0)
            ),
            'all', jsonb_build_object(
              'count', count(*),
              'value', coalesce(sum(value), 0)
            )
          )
        ) as row
      from open_leads
      group by stage
    ) t
  ),
  'sources', (
    select coalesce(jsonb_agg(row order by cnt desc, source asc), '[]'::jsonb)
    from (
      select c.source, count(*) as cnt,
        jsonb_build_object(
          'source', c.source,
          'count', count(*),
          'signedCount', count(*) filter (where ce.signed_cents > 0),
          'signedCents', coalesce(sum(ce.signed_cents) filter (where ce.signed_cents > 0), 0)
        ) as row
      from cohort c
      left join cohort_est ce on ce.lead_id = c.id
      group by c.source
    ) t
  ),
  'aging', jsonb_build_object(
    'notYetDueCents', (
      select coalesce(sum(owed), 0) from phase_rows
      where owed > 0 and state in ('billed', 'partial', 'clearing')
    ),
    'late1_30Cents', (
      select coalesce(sum(owed), 0) from phase_rows
      where owed > 0 and state = 'overdue' and late <= 30
    ),
    'late31_60Cents', (
      select coalesce(sum(owed), 0) from phase_rows
      where owed > 0 and state = 'overdue' and late > 30 and late <= 60
    ),
    'late61PlusCents', (
      select coalesce(sum(owed), 0) from phase_rows
      where owed > 0 and state = 'overdue' and late > 60
    ),
    'overdueCount', (
      select count(*) from phase_rows where owed > 0 and state = 'overdue'
    )
  ),
  'team', (
    select coalesce(
      jsonb_agg(row order by cents desc, appts desc, rep asc), '[]'::jsonb
    )
    from (
      select coalesce(ts.rep, ta.rep) as rep,
             coalesce(ts.cents, 0) as cents,
             coalesce(ta.n, 0) as appts,
             jsonb_build_object(
               'rep', coalesce(ts.rep, ta.rep),
               'signedCount', coalesce(ts.n, 0),
               'signedCents', coalesce(ts.cents, 0),
               'appts', coalesce(ta.n, 0)
             ) as row
      from (
        select rep, count(*) as n, sum(cents) as cents
        from sale_credits
        where (p_from is null or signed_day >= p_from)
          and (p_to is null or signed_day <= p_to)
        group by rep
      ) ts
      full join (
        select assigned_to as rep, count(*) as n
        from win_events
        where assigned_to is not null
        group by assigned_to
      ) ta on ta.rep = ts.rep
    ) t
  ),
  'calls', jsonb_build_object(
    'dials', (
      select count(*) from call_logs
      where company_id = p_company
        and (p_from is null or (created_at at time zone 'utc')::date >= p_from)
        and (p_to is null or (created_at at time zone 'utc')::date <= p_to)
    ),
    'connected', (
      select count(*) from call_logs
      where company_id = p_company and duration_seconds > 0
        and (p_from is null or (created_at at time zone 'utc')::date >= p_from)
        and (p_to is null or (created_at at time zone 'utc')::date <= p_to)
    ),
    'talkSeconds', (
      select coalesce(sum(duration_seconds), 0) from call_logs
      where company_id = p_company
        and (p_from is null or (created_at at time zone 'utc')::date >= p_from)
        and (p_to is null or (created_at at time zone 'utc')::date <= p_to)
    ),
    'perDay', (
      select jsonb_agg(
        jsonb_build_object('day', to_char(d.d, 'YYYY-MM-DD'), 'dials', coalesce(c.n, 0))
        order by d.d
      )
      from generate_series(p_calls_from, p_today, interval '1 day') as d(d)
      left join (
        select (created_at at time zone 'utc')::date as day, count(*) as n
        from call_logs
        where company_id = p_company
          and (created_at at time zone 'utc')::date >= p_calls_from
        group by 1
      ) c on c.day = d.d::date
    )
  ),
  'production', jsonb_build_object(
    'notStarted', (
      select count(*) from jobs where company_id = p_company and status = 'Not Started'
    ),
    'inProgress', (
      select count(*) from jobs where company_id = p_company and status = 'In Progress'
    ),
    'onHold', (
      select count(*) from jobs where company_id = p_company and status = 'On Hold'
    ),
    'completedInWindow', (
      select count(*) from jobs
      where company_id = p_company and status = 'Complete'
        and (p_from is null
             or coalesce(end_date, (updated_at at time zone 'utc')::date) >= p_from)
        and (p_to is null
             or coalesce(end_date, (updated_at at time zone 'utc')::date) <= p_to)
    )
  )
)
$function$;

commit;

-- Check: should read true.
select
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'estimate_payments' and column_name = 'credit_cents')
  and exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'bill_credits')
  and exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'give_bill_credit')
  and pg_get_functiondef('public.dashboard_rollup'::regproc) like '%credit_cents%'
  as bill_credits_ready;
