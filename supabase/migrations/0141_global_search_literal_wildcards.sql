-- Global search: match % and _ literally, like the app does.
--
-- 0140 left % and _ as LIKE wildcards on the theory that extra SQL
-- matches "only widen recall" before the app's literal re-filter. But
-- each CTE applies `limit p_limit` (8) BEFORE that re-filter, so
-- wildcard false-positives can fill all 8 slots and crowd out the real
-- hits: searching "50%" in a company whose newest rows merely contain
-- "50" returns 8 rows the app then drops — and the note that really
-- says "50% deposit due" never leaves Postgres. The UI falsely shows
-- "No matches". Escaping % and _ (backslash already was) makes SQL and
-- the app agree on what a match is.
--
-- Everything else is unchanged from 0140.

create or replace function public.global_search(
  p_company uuid,
  p_query text,
  p_include_docs boolean default true,
  p_include_bills boolean default false,
  p_limit int default 8
) returns jsonb
language sql
stable
set search_path = public
as $$
with q as (
  -- Escape LIKE's specials — backslash first, then % and _ — so every
  -- typed character matches itself, exactly as the app-side re-filter
  -- (src/lib/data/global-search.ts) treats it.
  select '%' || replace(replace(replace(lower(trim(p_query)),
                  '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat,
         regexp_replace(p_query, '\D', '', 'g') as digits
),
lead_names as (
  -- display_name must read exactly like leadDisplayName() in
  -- src/lib/data/types.ts, because the app re-filters against that
  -- rendering before showing a hit.
  select l.*,
         case
           when l.contact_type = 'Company'
             then coalesce(nullif(l.company_name, ''), 'Unnamed Company')
           else coalesce(nullif(trim(concat_ws(' ', l.first_name, l.last_name)), ''), 'Unnamed')
         end as display_name
  from leads l
  where l.company_id = p_company
),
matched_leads as (
  select ln.id, ln.contact_type, ln.company_name, ln.first_name, ln.last_name,
         ln.phone, ln.email, ln.address, ln.stage, ln.created_at
  from lead_names ln
  cross join q
  where lower(concat_ws(' ', ln.display_name, ln.phone, ln.address, ln.email)) like q.pat
     -- Digits-only search must find a formatted stored number, mirroring
     -- normalizePhone(): strip to digits, keep the last 10 when longer.
     or (length(q.digits) >= 3 and ln.phone is not null
         and (case when length(regexp_replace(ln.phone, '\D', '', 'g')) > 10
                   then right(regexp_replace(ln.phone, '\D', '', 'g'), 10)
                   else regexp_replace(ln.phone, '\D', '', 'g') end)
             like '%' || q.digits || '%')
  order by ln.created_at desc
  limit p_limit
),
matched_estimates as (
  -- Client name counts as document text on purpose: typing a customer's
  -- name surfaces their contract next to their contact card.
  select e.id, e.lead_id, e.doc_number, e.title, e.status, e.kind,
         e.job_address, e.total_cents, e.created_at
  from estimates e
  left join lead_names cl on cl.id = e.lead_id
  cross join q
  where p_include_docs
    and e.company_id = p_company
    and lower(concat_ws(' ', e.doc_number, e.title, e.job_address, cl.display_name)) like q.pat
  order by e.created_at desc
  limit p_limit
),
matched_events as (
  select ev.id, ev.title, ev.date, ev.time, ev.event_type, ev.status,
         ev.lead_id, ev.notes
  from events ev
  left join lead_names cl on cl.id = ev.lead_id
  cross join q
  where ev.company_id = p_company
    and lower(concat_ws(' ', ev.title, ev.event_type, ev.notes, cl.display_name)) like q.pat
  order by ev.date desc
  limit p_limit
),
matched_bills as (
  select b.id, b.vendor_name, b.reference, b.amount_cents, b.due_date,
         b.notes, b.voided_at, b.created_at
  from vendor_bills b
  cross join q
  where p_include_bills
    and b.company_id = p_company
    and lower(concat_ws(' ', b.vendor_name, b.reference, b.notes)) like q.pat
  order by b.created_at desc
  limit p_limit
),
matched_notes as (
  -- lead_notes has no company_id; scoping rides the join to this
  -- company's (and this caller's RLS-visible) leads.
  select n.id, n.lead_id, n.body, n.created_at
  from lead_notes n
  join lead_names l on l.id = n.lead_id
  cross join q
  where lower(n.body) like q.pat
  order by n.created_at desc
  limit p_limit
),
-- The leads that matched documents/appointments/notes point at, so the
-- app can print the client's name on those hits even when the lead
-- itself was not a contact match.
context_leads as (
  select ln.id, ln.contact_type, ln.company_name, ln.first_name, ln.last_name,
         ln.phone, ln.email, ln.address, ln.stage
  from lead_names ln
  where ln.id in (
    select lead_id from matched_estimates where lead_id is not null
    union
    select lead_id from matched_events where lead_id is not null
    union
    select lead_id from matched_notes
  )
)
select jsonb_build_object(
  'leads',         (select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at desc), '[]'::jsonb) from matched_leads m),
  'context_leads', (select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) from context_leads m),
  'estimates',     (select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at desc), '[]'::jsonb) from matched_estimates m),
  'events',        (select coalesce(jsonb_agg(to_jsonb(m) order by m.date desc), '[]'::jsonb) from matched_events m),
  'bills',         (select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at desc), '[]'::jsonb) from matched_bills m),
  'notes',         (select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at desc), '[]'::jsonb) from matched_notes m),
  'stages',        (select coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'color', s.color)), '[]'::jsonb)
                    from pipeline_stages s where s.company_id = p_company)
);
$$;
