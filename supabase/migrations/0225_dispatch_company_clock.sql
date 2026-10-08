-- 0225: the Dispatch Dashboard files everything on the company's day
-- (DECISIONS #176), as 0224 did for the main dashboard.
--
-- Until now dispatch_rollup filed new leads, booked appointments, calls,
-- texts and how long a lead has waited by the UTC day, which on the West
-- Coast starts at 5pm (4pm in winter), so each period ran 5pm to 5pm:
-- Today took in last night's leads and calls, a custom range left out
-- its last evening, and a lead that came in after 5pm yesterday read as
-- under a day old.
--
-- The function now takes the company's time zone (p_zone, sent by the
-- app) and files every timestamp on that zone's calendar. Nothing else
-- changes: the body is 0211's with `at time zone 'utc'` read
-- `at time zone p_zone`. p_zone defaults to 'UTC', so an app that
-- doesn't send it yet reads exactly as before. The old signature is
-- dropped so the database holds one dispatch_rollup.
--
-- Until this runs, the app works out the same numbers itself, more
-- slowly. Run in the Supabase SQL editor, after 0211. Safe to run twice.

begin;

drop function if exists public.dispatch_rollup(uuid, date, date, date, date, date, timestamp with time zone, date, date, date, date);

CREATE OR REPLACE FUNCTION public.dispatch_rollup(p_company uuid, p_from date, p_to date, p_prev_from date, p_prev_to date, p_today date, p_now timestamp with time zone, p_week_end date, p_untouched_from date, p_results_from date, p_waiting_from date, p_zone text DEFAULT 'UTC')
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
           when (l.created_at at time zone p_zone)::date >= p_from
            and (p_to is null or (l.created_at at time zone p_zone)::date <= p_to) then 'cur'
           when p_prev_from is not null
            and (l.created_at at time zone p_zone)::date >= p_prev_from
            and (l.created_at at time zone p_zone)::date <= p_prev_to then 'prev'
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
    and (l.created_at at time zone p_zone)::date >= least(p_from, coalesce(p_prev_from, p_from))
    and (p_to is null or (l.created_at at time zone p_zone)::date <= p_to)
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
    and (l.created_at at time zone p_zone)::date >= p_waiting_from
),
untouched as (
  select w.created_at
  from waiting w
  where (w.created_at at time zone p_zone)::date >= p_untouched_from
    and not exists (select 1 from call_logs c where c.lead_id = w.id)
    and not exists (select 1 from sms_messages s where s.lead_id = w.id
                      and s.direction = 'outbound' and coalesce(s.channel, 'sms') <> 'rep')
    and not exists (select 1 from lead_notes n where n.lead_id = w.id)
),
booked as (
  select e.created_by,
         case
           when (e.created_at at time zone p_zone)::date >= p_from
            and (p_to is null or (e.created_at at time zone p_zone)::date <= p_to) then 'cur'
           when p_prev_from is not null
            and (e.created_at at time zone p_zone)::date between p_prev_from and p_prev_to then 'prev'
         end as period
  from events e
  where e.company_id = p_company
    and (e.created_at at time zone p_zone)::date >= least(p_from, coalesce(p_prev_from, p_from))
    and (p_to is null or (e.created_at at time zone p_zone)::date <= p_to)
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
           when (c.created_at at time zone p_zone)::date >= p_from
            and (p_to is null or (c.created_at at time zone p_zone)::date <= p_to) then 'cur'
           when p_prev_from is not null
            and (c.created_at at time zone p_zone)::date between p_prev_from and p_prev_to then 'prev'
         end as period
  from call_logs c
  where c.company_id = p_company
    and (c.created_at at time zone p_zone)::date >= least(p_from, coalesce(p_prev_from, p_from))
    and (p_to is null or (c.created_at at time zone p_zone)::date <= p_to)
),
texts as (
  select
    count(*) filter (where (s.created_at at time zone p_zone)::date >= p_from
                       and (p_to is null or (s.created_at at time zone p_zone)::date <= p_to)) as cur,
    count(*) filter (where p_prev_from is not null
                       and (s.created_at at time zone p_zone)::date between p_prev_from and p_prev_to) as prev
  from sms_messages s
  where s.company_id = p_company
    and s.direction = 'outbound' and coalesce(s.channel, 'sms') <> 'rep'
    and (s.created_at at time zone p_zone)::date >= least(p_from, coalesce(p_prev_from, p_from))
    and (p_to is null or (s.created_at at time zone p_zone)::date <= p_to)
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
      'under1', count(*) filter (where p_today - (created_at at time zone p_zone)::date < 1),
      'd1_3', count(*) filter (where p_today - (created_at at time zone p_zone)::date between 1 and 3),
      'd4_7', count(*) filter (where p_today - (created_at at time zone p_zone)::date between 4 and 7),
      'd8_14', count(*) filter (where p_today - (created_at at time zone p_zone)::date between 8 and 14),
      'd15plus', count(*) filter (where p_today - (created_at at time zone p_zone)::date > 14)
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

commit;

-- Check: should read true.
select exists (
  select 1 from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'dispatch_rollup'
    and pg_get_function_identity_arguments(p.oid) like '%p_zone text'
) and (
  select count(*) from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'dispatch_rollup'
) = 1 as dispatch_company_clock_ready;
