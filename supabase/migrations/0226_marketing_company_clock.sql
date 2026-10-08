-- 0226: Marketing Analytics files everything on the company's day
-- (DECISIONS #177), as 0224 and 0225 did for the two dashboards.
--
-- Until now marketing_analytics_rollup cut its periods at UTC midnight
-- and filed leads, estimates sent, contracts signed and the weekly strip
-- by the UTC day, which on the West Coast starts at 5pm (4pm in winter).
-- So a period started at 5pm the evening before and, with an end date,
-- ended at 5pm on its last day; a contract signed on a Sunday evening
-- went into a week the strip didn't show yet.
--
-- The function now takes the company's time zone (p_zone, sent by the
-- app). Nothing else changes: the body is 0195's with `at time zone
-- 'utc'` read `at time zone p_zone` -- both where a timestamp is read as
-- its day and where a day's first instant is worked out. p_zone defaults
-- to 'UTC', so an app that doesn't send it yet reads exactly as before.
-- The old signature is dropped so the database holds one
-- marketing_analytics_rollup.
--
-- Until this runs, the app works out the same numbers itself, more
-- slowly. Run in the Supabase SQL editor, after 0195. Safe to run twice.

begin;

drop function if exists public.marketing_analytics_rollup(uuid, date, date, date, date, date, date, numeric, text[]);

CREATE OR REPLACE FUNCTION public.marketing_analytics_rollup(p_company uuid, p_from date, p_to date, p_prev_from date, p_prev_to date, p_weeks_from date, p_today date, p_default_cost numeric, p_exclude_sources text[], p_zone text DEFAULT 'UTC')
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
    and (p_from is null or created_at >= (p_from::timestamp at time zone p_zone))
    and (p_to is null or created_at < ((p_to + 1)::timestamp at time zone p_zone))
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
    and created_at >= (p_prev_from::timestamp at time zone p_zone)
    and created_at < ((p_prev_to + 1)::timestamp at time zone p_zone)
    and not (coalesce(nullif(source, ''), 'Unknown') = any(coalesce(p_exclude_sources, '{}'::text[])))
),
-- True contracts, any status, with the lead's current holder beside the
-- document's own rep.
contracts as (
  select e.id, e.lead_id, e.status::text as status, e.assigned_to, e.total_cents,
         e.sales_rep_1, e.sales_rep_1_bp, e.sales_rep_2, e.sales_rep_2_bp,
         (coalesce(e.sent_at, e.issued_at, e.created_at) at time zone p_zone)::date as sent_day,
         e.signed_at,
         (e.signed_at at time zone p_zone)::date as signed_day,
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
      select date_trunc('week', created_at at time zone p_zone)::date as wk, count(*) as n
      from leads
      where company_id = p_company
        and created_at >= (p_weeks_from::timestamp at time zone p_zone)
        and not (coalesce(nullif(source, ''), 'Unknown') = any(coalesce(p_exclude_sources, '{}'::text[])))
      group by 1
    ) lw on lw.wk = w.d::date
    left join (
      select date_trunc('week', signed_at at time zone p_zone)::date as wk,
             count(*) as n, sum(total_cents) as cents
      from contracts
      where status = 'Signed' and signed_at is not null
        and signed_at >= (p_weeks_from::timestamp at time zone p_zone)
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

commit;

-- Check: should read true.
select exists (
  select 1 from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'marketing_analytics_rollup'
    and pg_get_function_identity_arguments(p.oid) like '%p_zone text'
) and (
  select count(*) from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'marketing_analytics_rollup'
) = 1 as marketing_company_clock_ready;
