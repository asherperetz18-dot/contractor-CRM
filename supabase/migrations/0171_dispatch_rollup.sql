-- Dispatch Dashboard: the whole page reduced in the database.
--
-- One call returns every card on /dispatch-dashboard. Its buckets are
-- pinned by src/lib/data/dispatch-rollup.ts and its tests, which also
-- serve as the fallback while this migration hasn't run (the page
-- catches the missing-function error and computes the same numbers
-- from targeted queries -- slower, identical figures). Same posture as
-- dashboard_rollup (0162).
--
--   * Every clock-dependent edge (today, the window, the previous
--     window, the week strip's end, the untouched/results/waiting
--     floors, and the real instant for ages) arrives as a parameter,
--     computed once in TypeScript. Timestamps bucket by their UTC date.
--   * A lead's FIRST TOUCH is the earliest call logged, customer text
--     sent, or note written on it. "Reached within the hour" is that
--     touch within 60 minutes of the lead arriving.
--   * "Untouched new" is a lead of the last 7 days still in a
--     pre-appointment stage with no touch at all; "waiting" is every
--     pre-appointment lead of the last 90 days, by age. The stage list
--     mirrors PRE_APPOINTMENT_STAGES in src/lib/data/types.ts.
--   * "Booked" is an appointment CREATED in the window, credited to
--     created_by (the dispatcher who booked it). "Showed" is one DATED
--     in the window with Showed or Won; "resolved" one with any result.
--   * Texts are outbound customer texts (channel other than 'rep').
--
-- security invoker, so RLS scopes every read exactly as the page's own
-- fetches: a dispatcher who is not a supervisor sees their own leads
-- and the unclaimed pool, nothing more. Idempotent; safe as one paste
-- and safe to run twice.

begin;

-- The rollup's hot paths.
create index if not exists events_company_created_idx on events (company_id, created_at);
create index if not exists call_logs_lead_created_idx on call_logs (lead_id, created_at);
create index if not exists sms_messages_lead_created_idx on sms_messages (lead_id, created_at);
create index if not exists lead_notes_lead_created_idx on lead_notes (lead_id, created_at);

create or replace function public.dispatch_rollup(
  p_company uuid,
  p_from date,
  p_to date,
  p_prev_from date,
  p_prev_to date,
  p_today date,
  p_now timestamptz,
  p_week_end date,
  p_untouched_from date,
  p_results_from date,
  p_waiting_from date
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
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
    and l.stage in ('Unsorted', 'New Lead', 'Meta', 'No Answer', 'Contacted')
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
$$;

commit;

-- Proof: the function exists and answers (an empty company, all zeros).
select (dispatch_rollup(
  '00000000-0000-0000-0000-000000000000', current_date - 6, null, current_date - 13, current_date - 7,
  current_date, now(), current_date + 6, current_date - 7, current_date - 14, current_date - 90
) -> 'window' ->> 'leads') as leads_in_empty_company;
