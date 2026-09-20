-- A sale is credited to the contract's Sales team seats.
--
-- Three answers to "who sold this" existed. The document carries the rep
-- it was stamped with at creation (estimates.assigned_to -- whoever held
-- the lead when the draft was raised); the lead carries whoever holds it
-- now; and the contract's Sales team panel carries the seats commission
-- is actually paid on (sales_rep_1/2 with their shares -- 0086, 0135,
-- 0163), seeded from the lead at signature and corrected by the office.
-- Marketing Analytics (0164), the rep report and the dashboard's team
-- panel (0162) all read the first, and put an $8,000 sale on the rep in
-- the zero-share second seat while the panel said 100% Frank.
--
-- This re-creates both functions with one rule, mirrored and pinned by
-- src/lib/data/sale-credit.ts and its tests:
--
--   * every seat with a share gets the sale, the dollars split by share
--     (the Salespeople grid's partnership rule, DECISIONS #050);
--   * seats named with no share anywhere: seat one, whole;
--   * no seats at all (signed before the panel existed): the rep stamped
--     on the document, whole;
--   * the closer follows a sale with a cut and never holds it.
--
-- An unsigned document still follows whoever holds the lead; a voided
-- one stays with its stamped rep (effectiveEstimateRepId). While here,
-- marketing_analytics_rollup's "default cost" check learns each source's
-- own default (lead_sources.default_lead_cost, 0166) -- so this expects
-- 0166 to have run first.
--
-- Both functions keep their signatures: the app calls them unchanged,
-- and until this runs it computes the old credit. Idempotent; safe as
-- one paste and safe to run twice.
--
-- The bought-list filter reads p_exclude_sources directly:
-- "= any((select ...))" is the row-subquery form in Postgres and fails
-- with "operator does not exist: text = text[]"; "= any(array)" is the
-- array match this needs. 0164 carried the same line and is fixed too.

begin;

-- 0164's paste rolled back on the array-match error this file also
-- carried, so its two indexes never landed. Idempotent, so harmless
-- where they did.
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
         stage::text as stage, value, has_appt, assigned_to, lead_cost, created_at,
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
         stage::text as stage, value, has_appt, assigned_to, lead_cost, created_at,
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
      'wonStage', count(*) filter (where stage = 'Won'),
      'wonStageValue', coalesce(sum(value) filter (where stage = 'Won'), 0),
      'wonNoContract', count(*) filter (where stage = 'Won' and signed_cents <= 0),
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
$$;

create or replace function public.dashboard_rollup(
  p_company uuid,
  p_from date,
  p_to date,
  p_prev_from date,
  p_prev_to date,
  p_months_from date,
  p_today date,
  p_d30 date,
  p_d60 date,
  p_d90 date,
  p_calls_from date
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
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
    and stage::text not in ('Won', 'Lost', 'DNC')
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
$$;

commit;

-- Verify: both functions re-created. Expect two rows.
select proname, pronargs
from pg_proc
where proname in ('marketing_analytics_rollup', 'dashboard_rollup')
order by proname;
