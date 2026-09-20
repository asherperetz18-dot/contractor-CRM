-- Marketing Analytics 2.0: the whole page reduced in the database, for
-- any date window.
--
-- The page used to ship a window's leads to the browser and do its math
-- there, with a separate served path for All Time (marketing_funnel_rollup,
-- 0157). This function serves every range the same way -- one call, the
-- rows the tiles, tables and charts render -- and adds what the redesign
-- needs: appointments and estimates per source, the rep report's funnel
-- per rep, a twelve-week strip, the previous period for deltas, and the
-- count of leads sitting at Won with no contract behind them. Its
-- buckets are pinned by src/lib/data/marketing-rollup.ts and its tests,
-- which also serve as the fallback while this migration hasn't run (the
-- page catches the missing-function error and reduces the same numbers
-- server-side -- slower, identical figures, browser unaffected).
--
--   * Money is a signed true contract (status 'Signed', kind 'contract').
--     Change orders and completions never count; a lead's pipeline stage
--     never makes revenue. wonStage / wonNoContract report the stage
--     beside the contracts only so the gap between them can be seen.
--   * The tiles, sources, stages and latest contracts read the window's
--     COHORT: leads created in it (UTC day), whatever happened since.
--   * The team rows follow the rep report: leads by cohort; appointments,
--     estimates and contracts DATED in the window; an estimate credited
--     to whoever holds the lead until signature or void freezes it on
--     the document's own rep (effectiveEstimateRepId); "no result" is a
--     past appointment with no outcome recorded.
--   * weeks is by date -- created day and signed day -- over twelve
--     Monday-start weeks from p_weeks_from, independent of the range.
--   * p_exclude_sources (the company's bought lists, when the toggle is
--     on) removes those sources' leads from every bucket, their
--     appointments and documents included. A blank source is 'Unknown'.
--   * p_default_cost is company_profile.default_lead_cost: atDefault
--     counts priced leads carrying exactly that placeholder, so the page
--     can say "default" instead of posing it as a measurement.
--
-- Every clock edge arrives as a parameter, computed once in TypeScript.
-- value and lead_cost stay in the dollars the leads table stores; every
-- *Cents figure is estimates.total_cents. security invoker, so RLS scopes
-- every read exactly as the page's own fetches. Idempotent; safe as one
-- paste and safe to run twice.

begin;

-- Hot paths: a lead's documents, and appointments by day.
create index if not exists estimates_company_lead_idx on estimates (company_id, lead_id);
create index if not exists events_company_date_idx on events (company_id, date);

create or replace function public.marketing_analytics_rollup(
  p_company uuid,
  p_from date,
  p_to date,
  p_prev_from date,
  p_prev_to date,
  p_weeks_from date,
  p_today date,
  p_default_cost numeric,
  p_exclude_sources text[]
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
with
ex_names as (
  select coalesce(p_exclude_sources, '{}'::text[]) as names
),
-- Leads whose source is switched off: their documents and appointments
-- leave with them. Empty (and unscanned) when nothing is excluded.
ex_leads as (
  select id
  from leads
  where company_id = p_company
    and cardinality((select names from ex_names)) > 0
    and coalesce(nullif(source, ''), 'Unknown') = any((select names from ex_names))
),
cohort as (
  select id, contact_type::text as contact_type, company_name, first_name, last_name, phone,
         coalesce(nullif(source, ''), 'Unknown') as source,
         stage::text as stage, value, has_appt, assigned_to, lead_cost, created_at
  from leads
  where company_id = p_company
    and (p_from is null or created_at >= (p_from::timestamp at time zone 'utc'))
    and (p_to is null or created_at < ((p_to + 1)::timestamp at time zone 'utc'))
    and not (coalesce(nullif(source, ''), 'Unknown') = any((select names from ex_names)))
),
prev_cohort as (
  select id, contact_type::text as contact_type, company_name, first_name, last_name, phone,
         coalesce(nullif(source, ''), 'Unknown') as source,
         stage::text as stage, value, has_appt, assigned_to, lead_cost, created_at
  from leads
  where company_id = p_company
    and p_prev_from is not null
    and created_at >= (p_prev_from::timestamp at time zone 'utc')
    and created_at < ((p_prev_to + 1)::timestamp at time zone 'utc')
    and not (coalesce(nullif(source, ''), 'Unknown') = any((select names from ex_names)))
),
-- True contracts, any status, with the lead's current holder beside the
-- document's own rep.
contracts as (
  select e.id, e.lead_id, e.status::text as status, e.assigned_to, e.total_cents,
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
  select case when status in ('Signed', 'Void') then assigned_to
              else coalesce(holder, assigned_to) end as rep
  from contracts
  where status <> 'Draft'
    and (p_from is null or sent_day >= p_from)
    and (p_to is null or sent_day <= p_to)
),
win_sales as (
  select assigned_to as rep, total_cents
  from contracts
  where status = 'Signed' and signed_at is not null and assigned_to is not null
    and (p_from is null or signed_day >= p_from)
    and (p_to is null or signed_day <= p_to)
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
      'wonStage', count(*) filter (where stage = 'Won'),
      'wonStageValue', coalesce(sum(value) filter (where stage = 'Won'), 0),
      'wonNoContract', count(*) filter (where stage = 'Won' and signed_cents <= 0),
      'spend', coalesce(sum(lead_cost) filter (where lead_cost > 0), 0),
      'costKnown', count(*) filter (where lead_cost > 0),
      'atDefault', count(*) filter (where lead_cost > 0 and p_default_cost is not null and lead_cost = p_default_cost)
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
          'atDefault', count(*) filter (where lead_cost > 0 and p_default_cost is not null and lead_cost = p_default_cost)
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
        and not (coalesce(nullif(source, ''), 'Unknown') = any((select names from ex_names)))
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
          'rep', k.assigned_to,
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
$$;

commit;

-- Verify: the function exists. Expect one row.
select proname, pronargs
from pg_proc
where proname = 'marketing_analytics_rollup';
