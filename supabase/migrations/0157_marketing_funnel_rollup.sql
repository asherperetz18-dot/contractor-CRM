-- The All Time marketing funnel, reduced in the database.
--
-- Marketing Analytics' windowed ranges fetch only their slice of leads;
-- All Time meant every lead -- fourteen columns times the whole book --
-- riding to the browser to make a handful of aggregate rows. This
-- function returns those rows directly. Its buckets are pinned by
-- src/lib/data/analytics-rollup.ts and its tests, which also serve as
-- the fallback while this migration hasn't run (the page catches the
-- missing-function error and scans as before, slow but correct):
--
--   * created/createdValue count every lead; won/wonValue and Recent
--     Won require stage 'Won' AND a won_at -- while the per-rep rows
--     count Won by stage alone. That asymmetry is the page's own.
--   * a blank or null source folds to 'Unknown'.
--   * spend/costKnown average lead cost only over leads that carry one.
--   * sold/revenue credit a lead only for signed true contracts --
--     change orders and completions are excluded by kind. Revenue is in
--     cents (estimates.total_cents); value and lead_cost stay in the
--     dollars the leads table stores. The two are never mixed.
--
-- security invoker, so RLS scopes the read exactly as the page's own
-- fetch. Idempotent; safe as one paste and safe to run twice.

create or replace function public.marketing_funnel_rollup(p_company uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
with l as (
  select id, contact_type, company_name, first_name, last_name, source,
         stage, value, created_at, won_at, has_appt, assigned_to,
         lead_cost, phone
  from leads
  where company_id = p_company
),
signed as (
  select lead_id, sum(total_cents) as revenue_cents
  from estimates
  where company_id = p_company
    and status = 'Signed'
    and coalesce(kind, 'contract') = 'contract'
  group by lead_id
)
select jsonb_build_object(
  'totals', (
    select jsonb_build_object(
      'created', count(*),
      'createdValue', coalesce(sum(value), 0),
      'won', count(*) filter (where stage = 'Won' and won_at is not null),
      'wonValue', coalesce(sum(value) filter (where stage = 'Won' and won_at is not null), 0)
    )
    from l
  ),
  'bySource', (
    select coalesce(jsonb_agg(row order by cnt desc), '[]'::jsonb)
    from (
      select
        count(*) as cnt,
        jsonb_build_object(
          'source', coalesce(nullif(l.source, ''), 'Unknown'),
          'count', count(*),
          'withAppt', count(*) filter (where l.has_appt),
          'spend', coalesce(sum(l.lead_cost) filter (where l.lead_cost > 0), 0),
          'costKnown', count(*) filter (where l.lead_cost > 0),
          'sold', count(*) filter (where s.revenue_cents > 0),
          'revenue', coalesce(sum(s.revenue_cents) filter (where s.revenue_cents > 0), 0)
        ) as row
      from l
      left join signed s on s.lead_id = l.id
      group by coalesce(nullif(l.source, ''), 'Unknown')
    ) t
  ),
  'byRep', (
    select coalesce(jsonb_agg(row), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'assigned_to', assigned_to,
        'count', count(*),
        'wonCount', count(*) filter (where stage = 'Won'),
        'wonValue', coalesce(sum(value) filter (where stage = 'Won'), 0)
      ) as row
      from l
      where assigned_to is not null
      group by assigned_to
    ) t
  ),
  'byStage', (
    select coalesce(jsonb_agg(row), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'stage', stage,
        'count', count(*),
        'value', coalesce(sum(value), 0)
      ) as row
      from l
      group by stage
    ) t
  ),
  'recentWon', (
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
    from (
      select id, contact_type, company_name, first_name, last_name, source,
             stage, value, created_at, won_at, has_appt, assigned_to,
             lead_cost, phone
      from l
      where stage = 'Won' and won_at is not null
      order by won_at desc
      limit 8
    ) t
  )
)
$$;
