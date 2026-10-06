-- Contacts, not leads (DECISIONS #156).
--
-- Everyone on the Pipeline is a contact. A contact counts as a lead only
-- when it came from a real lead source: its source is not blank and not
-- ticked "Bought list" in Settings > Lead Sources. This file:
--
--   1. adds the rule to the database (counts_as_lead, bought_list_keys),
--      the same rule as src/lib/lead-or-contact.ts;
--   2. ticks "CSV Import" as a bought list in every company -- the source
--      a spreadsheet import gets when no Source column is mapped;
--   3. prices a new contact from a bought list at $0 instead of the
--      company's default lead cost;
--   4. takes the default lead cost ($375, or the company's own default)
--      back off contacts already on a bought-list source, keeping the old
--      figures in lead_cost_cleared_0211 so it can be undone;
--   5. makes the dashboard and the dispatch dashboard count leads only.
--
-- Until this runs every number counts every contact, as before. Safe to
-- run twice. Needs 0210 (the dashboard below is 0210's with these edits).

-- ── 1. The rule ─────────────────────────────────────────────────────────

-- The flag itself is 0165's; repeated so this file stands alone.
alter table public.lead_sources
  add column if not exists bought_list boolean not null default false;

-- The company's bought-list sources as rule keys (lowercase, trimmed).
-- Runs as the caller, so it only ever sees the caller's own company.
create or replace function public.bought_list_keys(p_company uuid)
returns text[]
language sql
stable
set search_path = public
as $$
  select coalesce(array_agg(distinct lower(btrim(name))), '{}'::text[])
  from public.lead_sources
  where company_id = p_company and bought_list
$$;

-- A contact is a lead unless its source is blank or a bought list. A
-- source nobody ticked counts even when it isn't on the Settings list
-- (CallRail files calls under its own text, e.g. "Google Ads").
create or replace function public.counts_as_lead(p_source text, p_bought text[])
returns boolean
language sql
immutable
as $$
  select coalesce(btrim(p_source), '') <> ''
     and not (lower(btrim(p_source)) = any (coalesce(p_bought, '{}'::text[])))
$$;

-- ── 2. "CSV Import" is a bought list ───────────────────────────────────

update public.lead_sources
set bought_list = true
where lower(btrim(name)) = 'csv import' and not bought_list;

-- A company with imported contacts but no "CSV Import" on its list gets
-- one, ticked, so those contacts have a tick to follow.
insert into public.lead_sources (company_id, name, sort_order, bought_list)
select l.company_id, 'CSV Import',
       coalesce((select max(s.sort_order) from public.lead_sources s where s.company_id = l.company_id), 0) + 1,
       true
from (select distinct company_id from public.leads where lower(btrim(source)) = 'csv import') l
where not exists (
  select 1 from public.lead_sources s
  where s.company_id = l.company_id and lower(btrim(s.name)) = 'csv import'
);

-- ── 3. A new bought-list contact costs nothing ─────────────────────────

-- 0166's trigger, plus: a contact from a bought-list source is priced at
-- $0. What a list cost goes in as that month's spend for its source.
create or replace function public.apply_default_lead_cost()
returns trigger as $$
declare
  source_cost numeric;
  from_bought_list boolean := false;
begin
  if new.lead_cost is null then
    if new.source is not null and btrim(new.source) <> '' then
      select coalesce(bool_or(s.bought_list), false)
        into from_bought_list
        from public.lead_sources s
       where s.company_id = new.company_id
         and lower(btrim(s.name)) = lower(btrim(new.source));

      select s.default_lead_cost
        into source_cost
        from public.lead_sources s
       where s.company_id = new.company_id
         and lower(btrim(s.name)) = lower(btrim(new.source))
       order by (s.default_lead_cost is null), s.sort_order
       limit 1;
    end if;

    if from_bought_list then
      new.lead_cost := 0;
    elsif source_cost is not null then
      new.lead_cost := source_cost;
    else
      select default_lead_cost
        into new.lead_cost
        from public.company_profile
       where company_id = new.company_id;
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists leads_default_cost on public.leads;
create trigger leads_default_cost
  before insert on public.leads
  for each row execute function public.apply_default_lead_cost();

-- ── 4. Take the default cost back off bought-list contacts ─────────────

-- What was cleared, so it can be put back:
--   update public.leads l set lead_cost = b.lead_cost
--   from public.lead_cost_cleared_0211 b where b.lead_id = l.id;
create table if not exists public.lead_cost_cleared_0211 (
  lead_id uuid primary key,
  company_id uuid not null,
  lead_cost numeric not null,
  cleared_at timestamptz not null default now()
);
-- No policies: only the SQL editor reads it.
alter table public.lead_cost_cleared_0211 enable row level security;
-- Every company table carries the subscription lock (0175).
select public.apply_billing_lock_policies();

-- Only the stamped default ($375 from 0089, or the company's own
-- default), never a figure somebody typed in.
insert into public.lead_cost_cleared_0211 (lead_id, company_id, lead_cost)
select l.id, l.company_id, l.lead_cost
from public.leads l
join public.company_profile cp on cp.company_id = l.company_id
where l.lead_cost > 0
  and (l.lead_cost = 375 or l.lead_cost = cp.default_lead_cost)
  and exists (
    select 1 from public.lead_sources s
    where s.company_id = l.company_id
      and s.bought_list
      and lower(btrim(s.name)) = lower(btrim(l.source))
  )
on conflict (lead_id) do nothing;

-- Without touching each contact's "last updated" time (the dashboard's
-- stage panel buckets by it) or its won date: only the price changed.
alter table public.leads disable trigger leads_set_updated_at;
alter table public.leads disable trigger leads_set_won_at;
update public.leads l
set lead_cost = 0
from public.lead_cost_cleared_0211 b
where b.lead_id = l.id and l.lead_cost = b.lead_cost;
alter table public.leads enable trigger leads_set_updated_at;
alter table public.leads enable trigger leads_set_won_at;

-- ── 5. The dashboards count leads only ─────────────────────────────────

-- The dashboard: the 0210 definition. Its cohort (New leads, the funnel,
-- Win rate, Leads by source) and the previous period keep only leads;
-- window.contactsAdded counts the other contacts added in the window.
CREATE OR REPLACE FUNCTION public.dashboard_rollup(p_company uuid, p_from date, p_to date, p_prev_from date, p_prev_to date, p_months_from date, p_today date, p_d30 date, p_d60 date, p_d90 date, p_calls_from date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with
-- 0211: the sources ticked as bought lists, read once (DECISIONS #156).
bought as (select public.bought_list_keys(p_company) as keys),
-- Everyone added in the window; the cohort is the ones that are leads.
added as (
  select id, stage, value, has_appt, source
  from leads
  where company_id = p_company
    and (p_from is null or (created_at at time zone 'utc')::date >= p_from)
    and (p_to is null or (created_at at time zone 'utc')::date <= p_to)
),
cohort as (
  select id, stage, value, has_appt,
         coalesce(nullif(source, ''), 'Unknown') as source
  from added
  where public.counts_as_lead(source, (select keys from bought))
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
         -- Money on its way in: a refund still going through isn't (0210).
         coalesce(sum(pp.amount_cents) filter (where pp.status = 'pending' and pp.amount_cents > 0), 0) as pending,
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
    -- Contacts added that aren't leads: bought lists, no source.
    'contactsAdded', (select count(*) from added) - (select count(*) from cohort),
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
        and public.counts_as_lead(source, (select keys from bought))
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

-- The dispatch dashboard: the 0195 definition. New leads, Reached within
-- 1 hour, the untouched alert, Waiting for a first appointment and each
-- dispatcher's leads keep only leads.
CREATE OR REPLACE FUNCTION public.dispatch_rollup(p_company uuid, p_from date, p_to date, p_prev_from date, p_prev_to date, p_today date, p_now timestamp with time zone, p_week_end date, p_untouched_from date, p_results_from date, p_waiting_from date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with
-- 0211: the sources ticked as bought lists, read once (DECISIONS #156).
bought as (select public.bought_list_keys(p_company) as keys),
-- Leads of the window and of the previous window, each with its first
-- touch. Leads only: a bought-list import isn't a speed-to-lead race.
cohort_all as (
  select l.id, l.created_at, l.dispatcher_id,
         case
           when (l.created_at at time zone 'utc')::date >= p_from
            and (p_to is null or (l.created_at at time zone 'utc')::date <= p_to) then 'cur'
           when p_prev_from is not null
            and (l.created_at at time zone 'utc')::date >= p_prev_from
            and (l.created_at at time zone 'utc')::date <= p_prev_to then 'prev'
         end as period,
         (
           select min(t.at) from (
             select c.created_at as at from call_logs c where c.lead_id = l.id
             union all
             select s.created_at from sms_messages s
              where s.lead_id = l.id and s.direction = 'outbound'
                and coalesce(s.channel, 'sms') <> 'rep'
             union all
             select n.created_at from lead_notes n where n.lead_id = l.id
           ) t
         ) as first_touch_at
  from leads l
  where l.company_id = p_company
    and public.counts_as_lead(l.source, (select keys from bought))
    and (l.created_at at time zone 'utc')::date >= least(p_from, coalesce(p_prev_from, p_from))
    and (p_to is null or (l.created_at at time zone 'utc')::date <= p_to)
),
cohort as (select * from cohort_all where period = 'cur'),
prev_cohort as (select * from cohort_all where period = 'prev'),
speed as (
  select period,
         count(*) as leads,
         count(first_touch_at) as reached,
         count(*) filter (where first_touch_at is not null
                            and first_touch_at <= created_at + interval '60 minutes') as within_hour,
         percentile_cont(0.5) within group (
           order by extract(epoch from (first_touch_at - created_at)) / 60.0
         ) filter (where first_touch_at is not null) as median_minutes
  from cohort_all
  where period is not null
  group by period
),
-- Pre-appointment leads of the last 90 days: waiting for a first appointment.
waiting as (
  select l.id, l.created_at, l.dispatcher_id
  from leads l
  where l.company_id = p_company
    and public.counts_as_lead(l.source, (select keys from bought))
    and l.stage = any (public.pre_appointment_stage_names(p_company))
    and (l.created_at at time zone 'utc')::date >= p_waiting_from
),
untouched as (
  select w.created_at
  from waiting w
  where (w.created_at at time zone 'utc')::date >= p_untouched_from
    and not exists (select 1 from call_logs c where c.lead_id = w.id)
    and not exists (select 1 from sms_messages s where s.lead_id = w.id
                      and s.direction = 'outbound' and coalesce(s.channel, 'sms') <> 'rep')
    and not exists (select 1 from lead_notes n where n.lead_id = w.id)
),
booked as (
  select e.created_by,
         case
           when (e.created_at at time zone 'utc')::date >= p_from
            and (p_to is null or (e.created_at at time zone 'utc')::date <= p_to) then 'cur'
           when p_prev_from is not null
            and (e.created_at at time zone 'utc')::date between p_prev_from and p_prev_to then 'prev'
         end as period
  from events e
  where e.company_id = p_company
    and (e.created_at at time zone 'utc')::date >= least(p_from, coalesce(p_prev_from, p_from))
    and (p_to is null or (e.created_at at time zone 'utc')::date <= p_to)
),
dated as (
  select e.created_by, e.status,
         case
           when e.date >= p_from and (p_to is null or e.date <= p_to) then 'cur'
           when p_prev_from is not null and e.date between p_prev_from and p_prev_to then 'prev'
         end as period
  from events e
  where e.company_id = p_company
    and e.date >= least(p_from, coalesce(p_prev_from, p_from))
    and (p_to is null or e.date <= p_to)
),
calls as (
  select c.rep_id, c.duration_seconds, c.disposition,
         case
           when (c.created_at at time zone 'utc')::date >= p_from
            and (p_to is null or (c.created_at at time zone 'utc')::date <= p_to) then 'cur'
           when p_prev_from is not null
            and (c.created_at at time zone 'utc')::date between p_prev_from and p_prev_to then 'prev'
         end as period
  from call_logs c
  where c.company_id = p_company
    and (c.created_at at time zone 'utc')::date >= least(p_from, coalesce(p_prev_from, p_from))
    and (p_to is null or (c.created_at at time zone 'utc')::date <= p_to)
),
texts as (
  select
    count(*) filter (where (s.created_at at time zone 'utc')::date >= p_from
                       and (p_to is null or (s.created_at at time zone 'utc')::date <= p_to)) as cur,
    count(*) filter (where p_prev_from is not null
                       and (s.created_at at time zone 'utc')::date between p_prev_from and p_prev_to) as prev
  from sms_messages s
  where s.company_id = p_company
    and s.direction = 'outbound' and coalesce(s.channel, 'sms') <> 'rep'
    and (s.created_at at time zone 'utc')::date >= least(p_from, coalesce(p_prev_from, p_from))
    and (p_to is null or (s.created_at at time zone 'utc')::date <= p_to)
),
today_visits as (
  select e.id, e.time, e.end_time, e.title, e.lead_id, e.assigned_to, e.status,
         e.customer_confirmed, e.rep_confirmed,
         case
           when l.id is null then null
           when l.contact_type = 'Company' then coalesce(nullif(l.company_name, ''), 'Unnamed Company')
           else coalesce(nullif(trim(concat_ws(' ', l.first_name, l.last_name)), ''), 'Unnamed')
         end as lead_name
  from events e
  left join leads l on l.id = e.lead_id
  where e.company_id = p_company and e.date = p_today and e.status <> 'Cancelled'
),
desk_ids as (
  select dispatcher_id as id from cohort where dispatcher_id is not null
  union select dispatcher_id from waiting where dispatcher_id is not null
  union select rep_id from calls where period = 'cur' and rep_id is not null
  union select created_by from booked where period = 'cur' and created_by is not null
  union select created_by from dated where period = 'cur' and created_by is not null
),
desk as (
  select d.id,
         (select count(*) from cohort c where c.dispatcher_id = d.id) as leads_received,
         (select count(*) from waiting w where w.dispatcher_id = d.id) as leads_held,
         (select count(*) from calls c where c.period = 'cur' and c.rep_id = d.id) as dials,
         (select count(*) from calls c where c.period = 'cur' and c.rep_id = d.id
            and coalesce(c.duration_seconds, 0) > 0) as connected,
         (select count(*) from booked b where b.period = 'cur' and b.created_by = d.id) as booked,
         (select count(*) from dated x where x.period = 'cur' and x.created_by = d.id
            and x.status in ('Showed', 'Won')) as showed
  from desk_ids d
)
select jsonb_build_object(
  'attention', jsonb_build_object(
    'untouchedNew', (select count(*) from untouched),
    'untouchedOldestMinutes', (
      select greatest(0, floor(extract(epoch from (p_now - min(created_at))) / 60))::int
      from untouched
    ),
    'overdueTasks', (
      select count(*) from lead_tasks
      where company_id = p_company and completed_at is null and due_date < p_today
    ),
    'todayTotal', (select count(*) from today_visits),
    'todayUnconfirmed', (
      select count(*) from today_visits
      where status in ('New', 'Confirmed') and not customer_confirmed
    ),
    'resultsMissing', (
      select count(*) from events
      where company_id = p_company
        and date >= p_results_from and date < p_today
        and status in ('New', 'Confirmed')
    ),
    'unclaimedPool', (select count(*) from waiting where dispatcher_id is null)
  ),
  'window', jsonb_build_object(
    'leads', coalesce((select leads from speed where period = 'cur'), 0),
    'reached', coalesce((select reached from speed where period = 'cur'), 0),
    'reachedWithinHour', coalesce((select within_hour from speed where period = 'cur'), 0),
    'medianMinutes', (select round(median_minutes)::int from speed where period = 'cur'),
    'booked', (select count(*) from booked where period = 'cur'),
    'showed', (select count(*) from dated where period = 'cur' and status in ('Showed', 'Won')),
    'resolved', (select count(*) from dated where period = 'cur'
                   and status in ('Showed', 'Won', 'No-show', 'Cancelled')),
    'dials', (select count(*) from calls where period = 'cur'),
    'connected', (select count(*) from calls where period = 'cur'
                    and coalesce(duration_seconds, 0) > 0),
    'texts', (select cur from texts)
  ),
  'prev', jsonb_build_object(
    'leads', coalesce((select leads from speed where period = 'prev'), 0),
    'reached', coalesce((select reached from speed where period = 'prev'), 0),
    'reachedWithinHour', coalesce((select within_hour from speed where period = 'prev'), 0),
    'medianMinutes', (select round(median_minutes)::int from speed where period = 'prev'),
    'booked', (select count(*) from booked where period = 'prev'),
    'showed', (select count(*) from dated where period = 'prev' and status in ('Showed', 'Won')),
    'resolved', (select count(*) from dated where period = 'prev'
                   and status in ('Showed', 'Won', 'No-show', 'Cancelled')),
    'dials', (select count(*) from calls where period = 'prev'),
    'connected', (select count(*) from calls where period = 'prev'
                    and coalesce(duration_seconds, 0) > 0),
    'texts', (select prev from texts)
  ),
  'today', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', t.id, 'time', t.time, 'end_time', t.end_time, 'title', t.title,
        'lead_id', t.lead_id, 'lead_name', t.lead_name, 'assigned_to', t.assigned_to,
        'status', t.status, 'customer_confirmed', t.customer_confirmed,
        'rep_confirmed', t.rep_confirmed
      ) order by t.time nulls last, t.id
    ) from today_visits t
  ), '[]'::jsonb),
  'week', (
    select jsonb_agg(
      jsonb_build_object('day', to_char(d.d, 'YYYY-MM-DD'), 'count', coalesce(n.n, 0))
      order by d.d
    )
    from generate_series(p_today, p_week_end, interval '1 day') as d(d)
    left join (
      select date, count(*) as n from events
      where company_id = p_company and date between p_today and p_week_end
        and status <> 'Cancelled'
      group by date
    ) n on n.date = d.d::date
  ),
  'waiting', (
    select jsonb_build_object(
      'under1', count(*) filter (where p_today - (created_at at time zone 'utc')::date < 1),
      'd1_3', count(*) filter (where p_today - (created_at at time zone 'utc')::date between 1 and 3),
      'd4_7', count(*) filter (where p_today - (created_at at time zone 'utc')::date between 4 and 7),
      'd8_14', count(*) filter (where p_today - (created_at at time zone 'utc')::date between 8 and 14),
      'd15plus', count(*) filter (where p_today - (created_at at time zone 'utc')::date > 14)
    ) from waiting
  ),
  'outcomes', coalesce((
    select jsonb_agg(jsonb_build_object('disposition', o.disposition, 'count', o.n)
                     order by o.n desc, o.disposition)
    from (
      select disposition, count(*) as n from calls
      where period = 'cur' and disposition is not null and disposition <> 'No Disposition'
      group by disposition
    ) o
  ), '[]'::jsonb),
  'desk', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'dispatcher', d.id, 'leadsReceived', d.leads_received, 'leadsHeld', d.leads_held,
        'dials', d.dials, 'connected', d.connected, 'booked', d.booked, 'showed', d.showed
      ) order by d.booked desc, d.dials desc, d.leads_held desc, d.id
    ) from desk d
    where d.leads_received > 0 or d.leads_held > 0 or d.dials > 0 or d.booked > 0 or d.showed > 0
  ), '[]'::jsonb)
)
$function$;

-- ── Check ───────────────────────────────────────────────────────────────
-- Expect: rule_ready = true, csv_import_ticked = true for each company
-- that has the source, and cleared = how many contacts went to $0.
select
  public.counts_as_lead('Google Ads', array['csv import'])
    and not public.counts_as_lead('CSV Import', array['csv import'])
    and not public.counts_as_lead('  ', '{}') as rule_ready,
  (select bool_and(bought_list) from public.lead_sources where lower(btrim(name)) = 'csv import') as csv_import_ticked,
  (select count(*) from public.lead_cost_cleared_0211) as cleared;
