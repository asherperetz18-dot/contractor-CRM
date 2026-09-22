-- Global search: answer in milliseconds at 79,000 contacts, not seconds.
--
-- 0155 matched by rebuilding every contact's haystack on every search:
-- for each of ~79k leads, concat the fields, lower them, regexp-fold the
-- whitespace -- once PER QUERY WORD, inside a correlated subquery -- and
-- only then LIKE. Measured locally on 80k contacts + 40k notes: 3.2 s for
-- one word, 5.7 s for two, 8.2 s for "10525 w pico". On Supabase's shared
-- CPU, under RLS, that runs past the statement timeout (and Vercel's
-- function limit) and the app shows the error as "No matches" -- a client
-- visibly on the calendar that search swears does not exist.
--
-- Now every lead carries a stored, generated search_text column -- the
-- lowercased haystack, built once when the row is written, with each
-- phone's bare digits alongside so a digits-only query ("6263254475")
-- matches a formatted stored number ("(626) 325-4475") with a plain LIKE.
-- A pg_trgm GIN index on that column (and one on lower(body) for notes)
-- lets Postgres jump to the rows containing the query's longest word
-- instead of scanning the table; the remaining words filter those rows.
--
-- Whitespace folding is gone because it no longer changes any answer: the
-- query is split into words (0155), a word contains no whitespace, and
-- "does this word appear in the text" reads the same whether the text
-- has one space or three between words. Per-word matching alone is what
-- made "PETER  BAHGAT" findable; the fold was the expensive half of a
-- pair that only needed one.
--
-- The haystack also grows: a Company contact's person (first/last name),
-- the second contact's name and phone, phone2/phone3, email and zip all
-- find the record now. The app re-filter in src/lib/data/global-search.ts
-- reads the same fields; SQL and app must keep agreeing (DECISIONS #008).
--
-- Safe to run twice. Adding the column rewrites the leads table once
-- (seconds at 79k rows); the indexes build in a few seconds more.

-- ── pg_trgm, wherever this database keeps its extensions ─────────────

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'extensions') then
    execute 'create extension if not exists pg_trgm with schema extensions';
  else
    execute 'create extension if not exists pg_trgm';
  end if;
end $$;

-- ── leads.search_text ────────────────────────────────────────────────
-- Immutable expression only (a generated column demands it): plain ||
-- with coalesce rather than concat_ws (which is STABLE). Double spaces
-- from empty fields do not matter to a per-word LIKE.

alter table public.leads
  add column if not exists search_text text
  generated always as (
    lower(
      case
        when contact_type = 'Company' then coalesce(nullif(company_name, ''), 'Unnamed Company')
        else coalesce(nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''), 'Unnamed')
      end
      || ' ' || coalesce(company_name, '')
      || ' ' || coalesce(first_name, '')
      || ' ' || coalesce(last_name, '')
      || ' ' || coalesce(second_contact_first_name, '')
      || ' ' || coalesce(second_contact_last_name, '')
      || ' ' || coalesce(phone, '')
      || ' ' || coalesce(phone2, '')
      || ' ' || coalesce(phone3, '')
      || ' ' || coalesce(second_contact_phone, '')
      || ' ' || regexp_replace(coalesce(phone, ''), '\D', '', 'g')
      || ' ' || regexp_replace(coalesce(phone2, ''), '\D', '', 'g')
      || ' ' || regexp_replace(coalesce(phone3, ''), '\D', '', 'g')
      || ' ' || regexp_replace(coalesce(second_contact_phone, ''), '\D', '', 'g')
      || ' ' || coalesce(email, '')
      || ' ' || coalesce(second_contact_email, '')
      || ' ' || coalesce(address, '')
      || ' ' || coalesce(zip, '')
    )
  ) stored;

-- The trigram opclass lives in pg_trgm's schema, which differs between
-- Supabase (extensions) and a plain Postgres (public); name it explicitly.
do $$
declare
  trgm text := (select n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace
                where e.extname = 'pg_trgm');
begin
  execute format(
    'create index if not exists leads_search_text_trgm on public.leads using gin (search_text %I.gin_trgm_ops)',
    trgm);
  execute format(
    'create index if not exists lead_notes_body_trgm on public.lead_notes using gin (lower(body) %I.gin_trgm_ops)',
    trgm);
end $$;

-- ── the display name, as one expression the joins below can share ────
-- Must read exactly like leadDisplayName() in src/lib/data/types.ts.
-- Takes text: callers cast contact_type (an enum) explicitly.

create or replace function public.lead_display_name(
  p_contact_type text, p_company_name text, p_first_name text, p_last_name text
) returns text
language sql
immutable
as $$
  select case
    when p_contact_type = 'Company' then coalesce(nullif(p_company_name, ''), 'Unnamed Company')
    else coalesce(nullif(trim(coalesce(p_first_name, '') || ' ' || coalesce(p_last_name, '')), ''), 'Unnamed')
  end
$$;

-- ── global_search ────────────────────────────────────────────────────

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
with words as (
  -- One LIKE pattern per query word; backslash, % and _ escaped so every
  -- typed character matches itself (0141).   is the non-breaking space.
  select array_agg(pat order by length(pat) desc) as pats
  from (
    select '%' || replace(replace(replace(w, '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat
    from regexp_split_to_table(lower(p_query), '[\s ]+') w
    where w <> ''
  ) p
),
q as (
  -- anchor: the longest word, the one the trigram index narrows on
  -- first; every word (anchor included) is then checked with LIKE ALL.
  select coalesce(pats, '{}'::text[]) as pats,
         pats[1] as anchor
  from words
),
matched_leads as (
  select l.id, l.contact_type, l.company_name, l.first_name, l.last_name,
         l.phone, l.phone2, l.phone3, l.email, l.address, l.zip,
         l.second_contact_first_name, l.second_contact_last_name,
         l.second_contact_phone, l.second_contact_email,
         l.stage, l.created_at
  from leads l
  cross join q
  where l.company_id = p_company
    and l.search_text like q.anchor
    and l.search_text like all (q.pats)
  order by l.created_at desc
  limit p_limit
),
matched_estimates as (
  -- Client name counts as document text on purpose: typing a customer's
  -- name surfaces their contract next to their contact card.
  select e.id, e.lead_id, e.doc_number, e.title, e.status, e.kind,
         e.job_address, e.total_cents, e.created_at
  from estimates e
  left join leads cl on cl.id = e.lead_id
  cross join q
  where p_include_docs
    and e.company_id = p_company
    and lower(concat_ws(' ', e.doc_number, e.title, e.job_address,
                        lead_display_name(cl.contact_type::text, cl.company_name, cl.first_name, cl.last_name)))
        like all (q.pats)
  order by e.created_at desc
  limit p_limit
),
matched_events as (
  select ev.id, ev.title, ev.date, ev.time, ev.event_type, ev.status,
         ev.lead_id, ev.notes
  from events ev
  left join leads cl on cl.id = ev.lead_id
  cross join q
  where ev.company_id = p_company
    and lower(concat_ws(' ', ev.title, ev.event_type, ev.notes,
                        lead_display_name(cl.contact_type::text, cl.company_name, cl.first_name, cl.last_name)))
        like all (q.pats)
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
    and lower(concat_ws(' ', b.vendor_name, b.reference, b.notes)) like all (q.pats)
  order by b.created_at desc
  limit p_limit
),
matched_notes as (
  -- lead_notes has no company_id; scoping rides the join to this
  -- company's (and this caller's RLS-visible) leads.
  select n.id, n.lead_id, n.body, n.created_at
  from lead_notes n
  join leads l on l.id = n.lead_id and l.company_id = p_company
  cross join q
  where lower(n.body) like q.anchor
    and lower(n.body) like all (q.pats)
  order by n.created_at desc
  limit p_limit
),
-- The leads that matched documents/appointments/notes point at, so the
-- app can print the client's name on those hits even when the lead
-- itself was not a contact match.
context_leads as (
  select l.id, l.contact_type, l.company_name, l.first_name, l.last_name,
         l.phone, l.phone2, l.phone3, l.email, l.address, l.zip,
         l.second_contact_first_name, l.second_contact_last_name,
         l.second_contact_phone, l.second_contact_email,
         l.stage
  from leads l
  where l.id in (
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

-- ── Proof rather than a success message ─────────────────────────────

select attname as column_added, attgenerated = 's' as stored
from pg_attribute
where attrelid = 'public.leads'::regclass and attname = 'search_text';

select indexname from pg_indexes
where indexname in ('leads_search_text_trgm', 'lead_notes_body_trgm')
order by indexname;
