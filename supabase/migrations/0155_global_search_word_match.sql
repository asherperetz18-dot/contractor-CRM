-- Global search: match word by word, blind to stray whitespace.
--
-- A client stored as first_name "PETER " (trailing space) + last_name
-- "BAHGAT IBRAHIM" renders clean everywhere -- HTML collapses the
-- doubled space -- but search matched the typed query as ONE contiguous
-- substring of the raw stored text, so "PETER BAHGAT" found nothing
-- while the client sat in plain sight on his own estimate. The same
-- failure hides records behind non-breaking spaces pasted in from email,
-- a query whose words differ in order from the stored rendering
-- ("bahgat peter"), or one that skips a middle name ("peter ibrahim").
--
-- Now every haystack is whitespace-folded (any run of whitespace,
-- non-breaking space included, becomes one space) and the query is split
-- into words, each of which must appear somewhere in the folded
-- haystack, in any order, across field boundaries. The app-side
-- re-filter (src/lib/data/global-search.ts) applies the identical rule;
-- SQL and app must agree on what a match is (DECISIONS #008). LIKE
-- specials stay escaped per word (0141), and phone digit matching is
-- unchanged. Everything else is unchanged from 0141.

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
  -- One LIKE pattern per query word, each with backslash, % and _
  -- escaped so every typed character matches itself.   is the
  -- non-breaking space; [\s ]+ folds it with all other whitespace.
  select (select coalesce(
            array_agg('%' || replace(replace(replace(w, '\', '\\'), '%', '\%'), '_', '\_') || '%'),
            '{}'::text[])
          from regexp_split_to_table(lower(p_query), '[\s ]+') w
          where w <> '') as pats,
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
  where (select bool_and(
           regexp_replace(lower(concat_ws(' ', ln.display_name, ln.phone, ln.address, ln.email)),
                          '[\s ]+', ' ', 'g') like p)
         from unnest(q.pats) p)
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
    and (select bool_and(
           regexp_replace(lower(concat_ws(' ', e.doc_number, e.title, e.job_address, cl.display_name)),
                          '[\s ]+', ' ', 'g') like p)
         from unnest(q.pats) p)
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
    and (select bool_and(
           regexp_replace(lower(concat_ws(' ', ev.title, ev.event_type, ev.notes, cl.display_name)),
                          '[\s ]+', ' ', 'g') like p)
         from unnest(q.pats) p)
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
    and (select bool_and(
           regexp_replace(lower(concat_ws(' ', b.vendor_name, b.reference, b.notes)),
                          '[\s ]+', ' ', 'g') like p)
         from unnest(q.pats) p)
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
  where (select bool_and(
           regexp_replace(lower(n.body), '[\s ]+', ' ', 'g') like p)
         from unnest(q.pats) p)
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
