-- The Salespeople grid's tallies, grouped in the database.
--
-- The page used to scan every lead in the company (assigned_to, stage,
-- value -- slim, but still one row per lead) and reduce them in the
-- server component: at 79k leads that is ~80 sequential 1000-row pages
-- before the grid can say four numbers per rep. This function returns
-- the four numbers per rep directly, one row each.
--
-- The buckets are exactly src/lib/report-leads.ts's repLeadStats, which
-- remains as the fallback while this migration hasn't run (the page
-- catches the missing-function error and scans as before): assigned is
-- every lead pointing at the rep; open is any stage outside
-- Won/Lost/DNC; won counts and sums value only at Won.
--
-- security invoker, so RLS scopes the read exactly as the page's own
-- scan was scoped. Idempotent; safe as one paste and safe to run twice.

create or replace function public.rep_lead_stats(p_company uuid)
returns table (
  assigned_to uuid,
  assigned_count bigint,
  open_count bigint,
  won_count bigint,
  won_value numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    l.assigned_to,
    count(*) as assigned_count,
    count(*) filter (where l.stage not in ('Won', 'Lost', 'DNC')) as open_count,
    count(*) filter (where l.stage = 'Won') as won_count,
    coalesce(sum(l.value) filter (where l.stage = 'Won'), 0) as won_value
  from leads l
  where l.company_id = p_company
    and l.assigned_to is not null
  group by l.assigned_to
$$;
