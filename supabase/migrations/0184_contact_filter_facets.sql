-- The Contacts page's filter dropdowns: which sources, reps and stages
-- actually appear on the company's contacts.
--
-- Settings list the configured lead sources and pipeline stages, but
-- contacts also carry values from imports and integrations ("Vicidial",
-- "AI Receptionist") and reps who have since been deactivated. A value
-- the dropdown doesn't offer is a contact the filter can't reach. The
-- book is ~79k rows, so the distinct values are found here rather than
-- by shipping the book (DECISIONS #019/#020).
--
-- Until this runs, the page catches the missing-function error and
-- offers the Settings lists plus active Sales reps -- everything still
-- filters, the off-list values just aren't offered.
--
-- security invoker, so RLS scopes the read exactly as the page's own
-- fetch. Idempotent; safe as one paste and safe to run twice.

create or replace function public.contact_filter_facets(p_company uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
select jsonb_build_object(
  'sources', coalesce((
    select jsonb_agg(s order by s)
    from (
      select distinct source as s
      from leads
      where company_id = p_company and nullif(source, '') is not null
    ) t
  ), '[]'::jsonb),
  'reps', coalesce((
    select jsonb_agg(a)
    from (
      select distinct assigned_to as a
      from leads
      where company_id = p_company and assigned_to is not null
    ) t
  ), '[]'::jsonb),
  'stages', coalesce((
    select jsonb_agg(st order by st)
    from (
      select distinct stage as st
      from leads
      where company_id = p_company
    ) t
  ), '[]'::jsonb)
)
$$;
