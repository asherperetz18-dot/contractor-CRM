-- The incoming-text badge, reduced in the database.
--
-- Every open tab asks for this every 20 seconds (the popup watcher,
-- /api/popup-alerts). The answer used to be computed in the function
-- region from EVERY text of the last 30 days, walked out of Postgres in
-- 1000-row pages -- per poll, per tab, all day. This function returns
-- the three things the watcher needs, in one round trip:
--
--   * awaitingCount -- conversations whose newest message is the
--     customer's. A conversation is the lead, or (for a text never
--     linked to one) the other party's number: the sender of an inbound
--     text, the recipient of an outbound one, digits only, last ten --
--     normalizePhone's rule, and the key the Reply Inbox draws with.
--   * latestIso -- the newest text in the window, any direction, so the
--     browser's watermark advances (null when the window is empty).
--   * fresh -- the customer's texts newer than the watermark, newest
--     first, at most five, with the lead's name for the toast. No
--     watermark (a browser's first poll) means no popups, only the count.
--
-- Rep-facing texts are excluded exactly as the inbox excludes them:
-- channel 'rep' is not a customer conversation, except a crew reply tied
-- to nothing (inbound, no lead), which has nowhere else to exist.
--
-- Its buckets are pinned by src/lib/data/text-alert-rollup.ts and its
-- tests, which also serve as the fallback while this migration hasn't
-- run (the watcher catches the missing-function error and walks the
-- window as before -- slower, same numbers). See DECISIONS #060.
--
-- security invoker, so RLS scopes the read exactly as the watcher's own
-- fetch. Idempotent; safe as one paste and safe to run twice.

create index if not exists sms_messages_company_created_idx
  on public.sms_messages (company_id, created_at desc);

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
    coalesce(nullif(trim(concat_ws(' ', l.first_name, l.last_name)), ''), l.company_name, '') as name,
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
