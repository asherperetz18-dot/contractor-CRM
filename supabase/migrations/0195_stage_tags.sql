-- Stage tags (DECISIONS #120).
--
-- Each company names its own pipeline stages, but the app moved leads
-- by name: "Won" when a contract is signed, "Appointment Scheduled" when
-- a visit is booked, "Unsorted" for a new lead. So four stages couldn't
-- be renamed at all, and renaming any other one quietly switched its
-- automation off.
--
-- Now every standard stage carries a fixed tag (pipeline_stages.key) and
-- every lead carries the tag of the stage it is in (leads.stage_key).
-- Automations and reports go by the tag, so any stage can be renamed.
--
--   * leads.stage_key is kept by the database: set from the stage name
--     on every write. Writing only stage_key (an automation asking for
--     "won") puts the lead in that company's stage with that tag, under
--     whatever name it has now; if the company has no such stage, the
--     lead stays where it was.
--   * A new lead whose stage isn't on the company's board goes to the
--     company's intake stage (tag "unsorted") instead of nowhere.
--   * Renaming a stage moves its leads and the dialer outcomes that
--     point at it to the new name, in the same step.
--   * One meaning of "closed": won, lost, not interested, do-not-contact
--     (is_closed_stage). "Not Interested" used to count as open in
--     some reports and closed in others.
--   * marketing_funnel_rollup (0157) is dropped: nothing calls it since
--     0164 replaced it.
--
-- Safe to run twice.

-- ── 1. The tag on each standard stage ────────────────────────────────
alter table public.pipeline_stages add column if not exists key text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pipeline_stages_key_check') then
    alter table public.pipeline_stages add constraint pipeline_stages_key_check check (key in (
      'unsorted', 'new_lead', 'no_answer', 'contacted',
      'appointment_scheduled', 'appointment_follow_up', 'second_appointment',
      'estimate_prepared', 'proposal_sent', 'pending_finance', 'close_to_sale',
      'won', 'lost', 'not_interested', 'dnc'
    ));
  end if;
end
$$;

-- At most one stage per tag in a company: an automation has one place to go.
create unique index if not exists pipeline_stages_company_key_idx
  on public.pipeline_stages (company_id, key) where key is not null;

-- Tag the standard stages every company was given, by name. Case and
-- spaces don't matter (the old code matched "Proposal Sent" that way);
-- an exact match wins if a company somehow has both.
with standard(name, key) as (
  values
    ('Unsorted', 'unsorted'), ('New Lead', 'new_lead'), ('No Answer', 'no_answer'),
    ('Contacted', 'contacted'), ('Appointment Scheduled', 'appointment_scheduled'),
    ('Appointment Follow Up', 'appointment_follow_up'), ('2nd Appointment', 'second_appointment'),
    ('Estimate Prepared', 'estimate_prepared'), ('Proposal Sent', 'proposal_sent'),
    ('Pending Finance', 'pending_finance'), ('Close to Sale', 'close_to_sale'),
    ('Won', 'won'), ('Lost', 'lost'), ('Not Interested', 'not_interested'), ('DNC', 'dnc')
),
pick as (
  select distinct on (s.company_id, d.key) s.id, d.key
  from public.pipeline_stages s
  join standard d on lower(btrim(s.name)) = lower(d.name)
  where s.key is null
    and not exists (
      select 1 from public.pipeline_stages t where t.company_id = s.company_id and t.key = d.key
    )
  order by s.company_id, d.key, (s.name = d.name) desc, s.sort_order
)
update public.pipeline_stages s set key = p.key from pick p where s.id = p.id;

-- ── 2. The tag on each lead ──────────────────────────────────────────
alter table public.leads add column if not exists stage_key text;

-- Filled in for every existing lead without touching its "last updated"
-- time or its won date: nothing about the lead itself changed.
alter table public.leads disable trigger leads_set_updated_at;
alter table public.leads disable trigger leads_set_won_at;
update public.leads l
set stage_key = s.key
from public.pipeline_stages s
where s.company_id = l.company_id
  and s.name = l.stage
  and l.stage_key is distinct from s.key;
alter table public.leads enable trigger leads_set_updated_at;
alter table public.leads enable trigger leads_set_won_at;

create index if not exists leads_company_stage_key_idx on public.leads (company_id, stage_key);

-- Kept by the database on every write. Runs after fill_company_id (it
-- needs the company) and before leads_set_won_at (which reads the tag):
-- a table's triggers run in name order.
create or replace function public.resolve_lead_stage()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_name text;
begin
  -- Asked for by tag (an automation: "move to won"): this company's
  -- stage with that tag, by its current name. None: stay put.
  if new.stage_key is not null
     and (tg_op = 'INSERT'
          or (new.stage_key is distinct from old.stage_key and new.stage is not distinct from old.stage)) then
    select s.name into v_name
    from pipeline_stages s
    where s.company_id = new.company_id and s.key = new.stage_key;
    if v_name is not null then
      new.stage := v_name;
    end if;
  end if;

  -- A new lead never lands in a stage its company's board doesn't have
  -- (a renamed "Unsorted", say): it goes to the intake stage instead.
  if tg_op = 'INSERT' and not exists (
    select 1 from pipeline_stages s where s.company_id = new.company_id and s.name = new.stage
  ) then
    v_name := null;
    select s.name into v_name
    from pipeline_stages s
    where s.company_id = new.company_id and s.key = 'unsorted';
    if v_name is not null then
      new.stage := v_name;
    end if;
  end if;

  -- The tag always follows the name (none for a company's own stages).
  select s.key into new.stage_key
  from pipeline_stages s
  where s.company_id = new.company_id and s.name = new.stage;
  return new;
end
$fn$;

-- Only ever run as a trigger, never called directly.
revoke all on function public.resolve_lead_stage() from public, anon, authenticated;

drop trigger if exists leads_resolve_stage on public.leads;
create trigger leads_resolve_stage
  before insert or update of stage, stage_key on public.leads
  for each row execute function public.resolve_lead_stage();

-- The won date goes by the tag, so renaming "Won" doesn't restart it.
create or replace function public.set_won_at()
returns trigger
language plpgsql
as $fn$
begin
  if new.stage_key = 'won' and (tg_op = 'INSERT' or old.stage_key is distinct from 'won') then
    new.won_at = now();
  elsif new.stage_key is distinct from 'won' then
    new.won_at = null;
  end if;
  return new;
end;
$fn$;

-- ── 3. Renaming a stage takes its leads and dialer outcomes along ────
create or replace function public.follow_stage_rename()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  if new.name is distinct from old.name then
    update leads set stage = new.name
    where company_id = new.company_id and stage = old.name;
    update call_dispositions set move_to_stage = new.name
    where company_id = new.company_id and move_to_stage = old.name;
  end if;
  return null;
end
$fn$;

revoke all on function public.follow_stage_rename() from public, anon, authenticated;

drop trigger if exists pipeline_stages_follow_rename on public.pipeline_stages;
create trigger pipeline_stages_follow_rename
  after update of name on public.pipeline_stages
  for each row execute function public.follow_stage_rename();

-- ── 4. Shared meanings ───────────────────────────────────────────────
-- Closed: out of the working pipeline. The app's copy is
-- CLOSED_STAGE_KEYS in src/lib/pipeline/stage-keys.ts (a test keeps the
-- two the same).
create or replace function public.is_closed_stage(p_key text)
returns boolean
language sql
immutable
as $fn$
  select coalesce(p_key in ('won', 'lost', 'not_interested', 'dnc'), false)
$fn$;

-- Still waiting for a first appointment: the intake stages by tag, plus
-- a company's own stages placed before its Appointment Scheduled stage
-- on the board. The app's copy is preAppointmentStageNames() in
-- src/lib/pipeline/stage-keys.ts.
create or replace function public.pre_appointment_stage_names(p_company uuid)
returns text[]
language sql
stable
set search_path to 'public'
as $fn$
  select coalesce(array_agg(s.name), '{}'::text[])
  from pipeline_stages s
  where s.company_id = p_company
    and (
      s.key in ('unsorted', 'new_lead', 'no_answer', 'contacted')
      or (s.key is null and s.sort_order < (
        select a.sort_order from pipeline_stages a
        where a.company_id = p_company and a.key = 'appointment_scheduled'
      ))
    )
$fn$;

-- ── 5. Reports go by the tag ─────────────────────────────────────────
-- Each is the current definition with only its stage tests changed.

CREATE OR REPLACE FUNCTION public.rep_lead_stats(p_company uuid)
 RETURNS TABLE(assigned_to uuid, assigned_count bigint, open_count bigint, won_count bigint, won_value numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select
    t.rep_id as assigned_to,
    count(*) as assigned_count,
    count(*) filter (where not public.is_closed_stage(t.stage_key)) as open_count,
    count(*) filter (where t.stage_key = 'won') as won_count,
    coalesce(sum(t.value) filter (where t.stage_key = 'won'), 0) as won_value
  from (
    select
      l.assigned_to as rep_id,
      l.stage_key,
      case
        when l.partner_rep_id is not null
         and l.partner_rep_id is distinct from l.assigned_to
        then coalesce(l.value, 0) / 2.0
        else coalesce(l.value, 0)
      end as value
    from leads l
    where l.company_id = p_company
      and l.assigned_to is not null
    union all
    select
      l.partner_rep_id,
      l.stage_key,
      coalesce(l.value, 0) / 2.0
    from leads l
    where l.company_id = p_company
      and l.partner_rep_id is not null
      and l.partner_rep_id is distinct from l.assigned_to
  ) t
  group by t.rep_id
$function$;

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
  select ph.id, ph.amount_cents, ph.due_date,
         coalesce(sum(pp.amount_cents) filter (where pp.status = 'succeeded'), 0) as settled,
         coalesce(sum(pp.amount_cents) filter (where pp.status = 'pending'), 0) as pending,
         coalesce(bool_or(pp.status = 'succeeded'), false) as any_succeeded
  from estimate_payments ph
  join estimates e on e.id = ph.estimate_id and e.status = 'Signed'
  left join portal_payments pp on pp.estimate_payment_id = ph.id
  where ph.company_id = p_company and ph.requested_at is not null
  group by ph.id, ph.amount_cents, ph.due_date
),
phase_rows as (
  select greatest(0, amount_cents - settled) as owed,
         case
           when any_succeeded and settled >= amount_cents then 'paid'
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

CREATE OR REPLACE FUNCTION public.dispatch_rollup(p_company uuid, p_from date, p_to date, p_prev_from date, p_prev_to date, p_today date, p_now timestamp with time zone, p_week_end date, p_untouched_from date, p_results_from date, p_waiting_from date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with
-- Leads of the window and of the previous window, each with its first touch.
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

CREATE OR REPLACE FUNCTION public.marketing_analytics_rollup(p_company uuid, p_from date, p_to date, p_prev_from date, p_prev_to date, p_weeks_from date, p_today date, p_default_cost numeric, p_exclude_sources text[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with
-- Each source's own default lead cost (0166); the company default stands
-- in. A lead carrying exactly its default was never priced by anyone.
source_defaults as (
  select lower(btrim(name)) as key,
         (array_agg(default_lead_cost order by (default_lead_cost is null), sort_order))[1] as default_cost
  from lead_sources
  where company_id = p_company
  group by 1
),
-- Leads whose source is switched off: their documents and appointments
-- leave with them. Empty (and unscanned) when nothing is excluded.
ex_leads as (
  select id
  from leads
  where company_id = p_company
    and cardinality(coalesce(p_exclude_sources, '{}'::text[])) > 0
    and coalesce(nullif(source, ''), 'Unknown') = any(coalesce(p_exclude_sources, '{}'::text[]))
),
cohort as (
  select id, contact_type::text as contact_type, company_name, first_name, last_name, phone,
         coalesce(nullif(source, ''), 'Unknown') as source,
         stage::text as stage, stage_key, value, has_appt, assigned_to, lead_cost, created_at,
         coalesce(sd.default_cost, p_default_cost) as default_cost
  from leads
  left join source_defaults sd on sd.key = lower(btrim(coalesce(nullif(source, ''), 'Unknown')))
  where company_id = p_company
    and (p_from is null or created_at >= (p_from::timestamp at time zone 'utc'))
    and (p_to is null or created_at < ((p_to + 1)::timestamp at time zone 'utc'))
    and not (coalesce(nullif(source, ''), 'Unknown') = any(coalesce(p_exclude_sources, '{}'::text[])))
),
prev_cohort as (
  select id, contact_type::text as contact_type, company_name, first_name, last_name, phone,
         coalesce(nullif(source, ''), 'Unknown') as source,
         stage::text as stage, stage_key, value, has_appt, assigned_to, lead_cost, created_at,
         coalesce(sd.default_cost, p_default_cost) as default_cost
  from leads
  left join source_defaults sd on sd.key = lower(btrim(coalesce(nullif(source, ''), 'Unknown')))
  where company_id = p_company
    and p_prev_from is not null
    and created_at >= (p_prev_from::timestamp at time zone 'utc')
    and created_at < ((p_prev_to + 1)::timestamp at time zone 'utc')
    and not (coalesce(nullif(source, ''), 'Unknown') = any(coalesce(p_exclude_sources, '{}'::text[])))
),
-- True contracts, any status, with the lead's current holder beside the
-- document's own rep.
contracts as (
  select e.id, e.lead_id, e.status::text as status, e.assigned_to, e.total_cents,
         e.sales_rep_1, e.sales_rep_1_bp, e.sales_rep_2, e.sales_rep_2_bp,
         (coalesce(e.sent_at, e.issued_at, e.created_at) at time zone 'utc')::date as sent_day,
         e.signed_at,
         (e.signed_at at time zone 'utc')::date as signed_day,
         l.assigned_to as holder
  from estimates e
  left join leads l on l.id = e.lead_id
  where e.company_id = p_company
    and coalesce(e.kind, 'contract') = 'contract'
    and not exists (select 1 from ex_leads x where x.id = e.lead_id)
),
lead_contract as (
  select lead_id,
         bool_or(status <> 'Draft') as saw,
         coalesce(sum(total_cents) filter (where status = 'Signed'), 0) as signed_cents
  from contracts
  group by lead_id
),
-- Who a signed contract counts for: the Sales team seats with a share,
-- the dollars split by share; seats named without a share fall to seat
-- one; no seats at all falls to the rep stamped on the document. The
-- tested mirror is src/lib/data/sale-credit.ts.
contract_seats as (
  select id as contract_id, sales_rep_1 as rep, coalesce(sales_rep_1_bp, 10000) as bp, 1 as ord
  from contracts where sales_rep_1 is not null
  union all
  select id, sales_rep_2, coalesce(sales_rep_2_bp, 0), 2
  from contracts where sales_rep_2 is not null
),
contract_credits as (
  select k.id as contract_id, x.rep, x.bp, x.ord,
         round(k.total_cents * x.bp / 10000.0)::bigint as cents
  from contracts k
  join contract_seats x on x.contract_id = k.id and x.bp > 0
  union all
  select k.id,
         (select x.rep from contract_seats x where x.contract_id = k.id order by x.ord limit 1),
         10000, 1, k.total_cents
  from contracts k
  where exists (select 1 from contract_seats x where x.contract_id = k.id)
    and not exists (select 1 from contract_seats x where x.contract_id = k.id and x.bp > 0)
  union all
  select k.id, k.assigned_to, 10000, 1, k.total_cents
  from contracts k
  where k.assigned_to is not null
    and not exists (select 1 from contract_seats x where x.contract_id = k.id)
),
scoped as (
  select 'cur' as which, c.*, coalesce(lc.saw, false) as saw, coalesce(lc.signed_cents, 0) as signed_cents
  from cohort c left join lead_contract lc on lc.lead_id = c.id
  union all
  select 'prev', p.*, coalesce(lc.saw, false), coalesce(lc.signed_cents, 0)
  from prev_cohort p left join lead_contract lc on lc.lead_id = p.id
),
win_events as (
  select ev.assigned_to, ev.status::text as status, ev.date
  from events ev
  where ev.company_id = p_company
    and ev.assigned_to is not null
    and (p_from is null or ev.date >= p_from)
    and (p_to is null or ev.date <= p_to)
    and not exists (select 1 from ex_leads x where x.id = ev.lead_id)
),
sent_docs as (
  -- Signed: the seats. Voided: frozen on the stamped rep. Otherwise the
  -- document follows whoever holds the lead.
  select cr.rep
  from contracts k
  join contract_credits cr on cr.contract_id = k.id
  where k.status = 'Signed'
    and (p_from is null or k.sent_day >= p_from)
    and (p_to is null or k.sent_day <= p_to)
  union all
  select case when k.status = 'Void' then k.assigned_to
              else coalesce(k.holder, k.assigned_to) end
  from contracts k
  where k.status not in ('Draft', 'Signed')
    and (p_from is null or k.sent_day >= p_from)
    and (p_to is null or k.sent_day <= p_to)
),
win_sales as (
  select cr.rep, cr.cents as total_cents
  from contracts k
  join contract_credits cr on cr.contract_id = k.id
  where k.status = 'Signed' and k.signed_at is not null
    and (p_from is null or k.signed_day >= p_from)
    and (p_to is null or k.signed_day <= p_to)
),
rep_ids as (
  select assigned_to as rep from scoped where which = 'cur' and assigned_to is not null
  union select assigned_to from win_events
  union select rep from sent_docs where rep is not null
  union select rep from win_sales
),
rep_rows as (
  select r.rep,
    (select count(*) from scoped c where c.which = 'cur' and c.assigned_to = r.rep) as leads,
    (select count(*) from win_events w where w.assigned_to = r.rep) as appts,
    (select count(*) from win_events w where w.assigned_to = r.rep and w.status in ('Showed', 'Won')) as attended,
    (select count(*) from win_events w where w.assigned_to = r.rep and w.status = 'No-show') as no_show,
    (select count(*) from win_events w
      where w.assigned_to = r.rep and w.date < p_today
        and w.status not in ('Showed', 'Won', 'No-show', 'Cancelled')) as no_outcome,
    (select count(*) from sent_docs s where s.rep = r.rep) as estimates,
    (select count(*) from win_sales s where s.rep = r.rep) as signed,
    (select coalesce(sum(total_cents), 0) from win_sales s where s.rep = r.rep) as signed_cents
  from rep_ids r
)
select jsonb_build_object(
  'totals', (
    select jsonb_build_object(
      'leads', count(*),
      'leadValue', coalesce(sum(value), 0),
      'withAppt', count(*) filter (where has_appt),
      'estimated', count(*) filter (where saw),
      'signed', count(*) filter (where signed_cents > 0),
      'signedCents', coalesce(sum(signed_cents) filter (where signed_cents > 0), 0),
      'wonStage', count(*) filter (where stage_key = 'won'),
      'wonStageValue', coalesce(sum(value) filter (where stage_key = 'won'), 0),
      'wonNoContract', count(*) filter (where stage_key = 'won' and signed_cents <= 0),
      'spend', coalesce(sum(lead_cost) filter (where lead_cost > 0), 0),
      'costKnown', count(*) filter (where lead_cost > 0),
      'atDefault', count(*) filter (where lead_cost > 0 and default_cost is not null and lead_cost = default_cost)
    )
    from scoped where which = 'cur'
  ),
  'prev', case when p_prev_from is null then null else (
    select jsonb_build_object(
      'leads', count(*),
      'withAppt', count(*) filter (where has_appt),
      'signed', count(*) filter (where signed_cents > 0),
      'signedCents', coalesce(sum(signed_cents) filter (where signed_cents > 0), 0)
    )
    from scoped where which = 'prev'
  ) end,
  'bySource', (
    select coalesce(
      jsonb_agg(row order by signed_cents desc, signed desc, with_appt desc, cnt desc, source asc),
      '[]'::jsonb
    )
    from (
      select source,
        count(*) as cnt,
        count(*) filter (where has_appt) as with_appt,
        count(*) filter (where signed_cents > 0) as signed,
        coalesce(sum(signed_cents) filter (where signed_cents > 0), 0) as signed_cents,
        jsonb_build_object(
          'source', source,
          'count', count(*),
          'withAppt', count(*) filter (where has_appt),
          'estimated', count(*) filter (where saw),
          'signed', count(*) filter (where signed_cents > 0),
          'signedCents', coalesce(sum(signed_cents) filter (where signed_cents > 0), 0),
          'spend', coalesce(sum(lead_cost) filter (where lead_cost > 0), 0),
          'costKnown', count(*) filter (where lead_cost > 0),
          'atDefault', count(*) filter (where lead_cost > 0 and default_cost is not null and lead_cost = default_cost)
        ) as row
      from scoped
      where which = 'cur'
      group by source
    ) t
  ),
  'byRep', (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'rep', rep, 'leads', leads, 'appts', appts, 'attended', attended,
          'noShow', no_show, 'noOutcome', no_outcome, 'estimates', estimates,
          'signed', signed, 'signedCents', signed_cents
        )
        order by signed_cents desc, signed desc, appts desc, leads desc, rep asc
      ),
      '[]'::jsonb
    )
    from rep_rows
  ),
  'byStage', (
    select coalesce(jsonb_agg(row order by stage), '[]'::jsonb)
    from (
      select stage,
        jsonb_build_object('stage', stage, 'count', count(*), 'value', coalesce(sum(value), 0)) as row
      from scoped
      where which = 'cur'
      group by stage
    ) t
  ),
  'weeks', (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'week', to_char(w.d, 'YYYY-MM-DD'),
        'leads', coalesce(lw.n, 0),
        'signed', coalesce(sw.n, 0),
        'signedCents', coalesce(sw.cents, 0)
      ) order by w.d
    ), '[]'::jsonb)
    from generate_series(p_weeks_from::timestamp, (p_weeks_from + 77)::timestamp, interval '7 days') as w(d)
    left join (
      select date_trunc('week', created_at at time zone 'utc')::date as wk, count(*) as n
      from leads
      where company_id = p_company
        and created_at >= (p_weeks_from::timestamp at time zone 'utc')
        and not (coalesce(nullif(source, ''), 'Unknown') = any(coalesce(p_exclude_sources, '{}'::text[])))
      group by 1
    ) lw on lw.wk = w.d::date
    left join (
      select date_trunc('week', signed_at at time zone 'utc')::date as wk,
             count(*) as n, sum(total_cents) as cents
      from contracts
      where status = 'Signed' and signed_at is not null
        and signed_at >= (p_weeks_from::timestamp at time zone 'utc')
      group by 1
    ) sw on sw.wk = w.d::date
  ),
  'recentSigned', (
    select coalesce(jsonb_agg(row order by signed_at desc), '[]'::jsonb)
    from (
      select k.signed_at,
        jsonb_build_object(
          'estimateId', k.id,
          'leadId', c.id,
          'contact_type', c.contact_type,
          'company_name', c.company_name,
          'first_name', c.first_name,
          'last_name', c.last_name,
          'source', c.source,
          'rep', coalesce(
            (select cr.rep from contract_credits cr where cr.contract_id = k.id order by cr.ord limit 1),
            k.assigned_to
          ),
          'signedAt', k.signed_at,
          'totalCents', k.total_cents,
          'createdAt', c.created_at
        ) as row
      from contracts k
      join cohort c on c.id = k.lead_id
      where k.status = 'Signed' and k.signed_at is not null
      order by k.signed_at desc
      limit 8
    ) t
  )
)
$function$;

-- Replaced by marketing_analytics_rollup (0164); nothing calls it.
drop function if exists public.marketing_funnel_rollup(uuid);

-- Check: every column should read true.
select
  exists (select 1 from information_schema.columns
          where table_name = 'leads' and column_name = 'stage_key') as leads_have_tags,
  not exists (select 1 from public.leads l
              join public.pipeline_stages s on s.company_id = l.company_id and s.name = l.stage
              where l.stage_key is distinct from s.key) as every_lead_tagged,
  not exists (select 1 from public.companies c
              where not exists (select 1 from public.pipeline_stages s
                                where s.company_id = c.id and s.key = 'won')) as every_company_has_won;
