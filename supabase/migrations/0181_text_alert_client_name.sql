-- The incoming-text toast names the client the way every screen does.
--
-- 0168's text_alert_rollup named a text's lead person-first ("Josh
-- Martinez"), so a text from the contact at a company client popped up
-- under the person while the Reply Inbox, the lead card and every
-- document said the company. Same function, one change: a Company
-- contact is its company name; an Individual is first + last -- the
-- rule in src/lib/data/client-name.ts. A lead with no name still gives
-- '' and the toast shows the number, as before.
--
-- Until this runs the old function keeps answering (person-first); the
-- watcher's fallback path already uses the new rule. Idempotent; safe as
-- one paste and safe to run twice.

create or replace function public.text_alert_rollup(
  p_company uuid,
  p_since timestamptz,
  p_window_start timestamptz
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
with w as (
  select
    id, lead_id, direction, from_number, to_number, body, created_at,
    coalesce(
      lead_id::text,
      'phone:' || right(
        regexp_replace(case when direction = 'inbound' then from_number else to_number end, '\D', '', 'g'),
        10
      )
    ) as conv_key
  from sms_messages
  where company_id = p_company
    and created_at >= p_window_start
    and (channel <> 'rep' or (channel = 'rep' and lead_id is null and direction = 'inbound'))
),
newest as (
  select distinct on (conv_key) conv_key, direction
  from w
  order by conv_key, created_at desc, id desc
),
fresh as (
  select
    w.id,
    w.lead_id,
    w.from_number,
    case
      when l.contact_type = 'Company' then coalesce(l.company_name, '')
      else trim(concat_ws(' ', l.first_name, l.last_name))
    end as name,
    left(coalesce(w.body, ''), 90) as preview,
    w.created_at
  from w
  left join leads l on l.id = w.lead_id
  where p_since is not null and w.direction = 'inbound' and w.created_at > p_since
  order by w.created_at desc, w.id desc
  limit 5
)
select jsonb_build_object(
  'awaitingCount', (select count(*) from newest where direction = 'inbound'),
  'latestIso', (select max(created_at) from w),
  'fresh', (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', id,
          'leadId', lead_id,
          'fromNumber', from_number,
          'name', name,
          'preview', preview,
          'at', created_at
        )
        order by created_at desc, id desc
      ),
      '[]'::jsonb
    )
    from fresh
  )
);
$$;
