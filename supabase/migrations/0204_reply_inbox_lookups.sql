-- Reply Inbox at scale: two lookups by phone number (DECISIONS #141).
--
-- The inbox now reads only its newest conversations, and a conversation's
-- messages when it is opened. Two of its questions are about a phone
-- number, and neither could be asked of the database until now:
--
--   * Whose number is this? A text never linked to a contact is named by
--     matching its number to one. Contacts' numbers are stored however
--     they were typed, so the match is on digits, and the app walked the
--     company's ENTIRE contact book, 1000 rows at a time, to find a few
--     names -- on every visit and on every new text.
--   * What was said with this number? Opening such a conversation needs
--     its texts by number, again on digits.
--
-- A number's key is the one the app and 0168 use: its digits, the last
-- ten when there are more (normalizePhone). Each lookup below compares on
-- exactly that expression, and an index holds it, so the answer is a
-- handful of rows instead of a walk.
--
-- Both functions run as the person asking (security invoker), so row
-- level security applies as on any read: their own company only, and
-- 0192's rule on who sees which texts.
--
-- Until this runs, the app falls back to the old reads: nothing breaks,
-- it is only slower. Changes no table and no row. Safe as one paste, and
-- safe to run twice.

-- ── Whose number is this? ────────────────────────────────────────────

create index if not exists leads_phone_digits_idx
  on public.leads (company_id, right(regexp_replace(phone, '\D', '', 'g'), 10));

create index if not exists leads_second_contact_phone_digits_idx
  on public.leads (company_id, right(regexp_replace(second_contact_phone, '\D', '', 'g'), 10));

-- Newest first: when two contacts share a number, the newest one names
-- the conversation, as it always has.
create or replace function public.leads_by_phone_keys(p_company uuid, p_keys text[])
returns setof public.leads
language sql
stable
security invoker
set search_path to 'public'
as $$
  select l.*
  from public.leads l
  where l.company_id = p_company
    and (
      right(regexp_replace(l.phone, '\D', '', 'g'), 10) = any (p_keys)
      or right(regexp_replace(l.second_contact_phone, '\D', '', 'g'), 10) = any (p_keys)
    )
  order by l.created_at desc
  limit 1000
$$;

revoke all on function public.leads_by_phone_keys(uuid, text[]) from public, anon;
grant execute on function public.leads_by_phone_keys(uuid, text[]) to authenticated, service_role;

-- ── What was said with this number? ──────────────────────────────────

-- Only texts never linked to a contact: a linked one is found by its
-- contact (sms_messages_lead_created_idx).
create index if not exists sms_messages_unlinked_counterparty_idx
  on public.sms_messages (
    company_id,
    right(regexp_replace(case when direction = 'inbound' then from_number else to_number end, '\D', '', 'g'), 10),
    created_at desc
  )
  where lead_id is null;

-- The newest p_limit texts of one unlinked conversation, newest first.
-- Rep-facing texts are left out as the inbox leaves them out: with no
-- contact, only a crew member's own reply is kept.
create or replace function public.reply_inbox_unlinked_thread(p_company uuid, p_phone_key text, p_limit integer)
returns setof public.sms_messages
language sql
stable
security invoker
set search_path to 'public'
as $$
  select m.*
  from public.sms_messages m
  where m.company_id = p_company
    and m.lead_id is null
    and right(regexp_replace(case when m.direction = 'inbound' then m.from_number else m.to_number end, '\D', '', 'g'), 10) = p_phone_key
    and (m.channel <> 'rep' or m.direction = 'inbound')
  order by m.created_at desc, m.id desc
  limit least(greatest(coalesce(p_limit, 101), 1), 1000)
$$;

revoke all on function public.reply_inbox_unlinked_thread(uuid, text, integer) from public, anon;
grant execute on function public.reply_inbox_unlinked_thread(uuid, text, integer) to authenticated, service_role;

-- Check: should read true.
select
  (select count(*) from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('leads_by_phone_keys', 'reply_inbox_unlinked_thread')) = 2
  and (select count(*) from pg_indexes
    where schemaname = 'public'
      and indexname in ('leads_phone_digits_idx', 'leads_second_contact_phone_digits_idx', 'sms_messages_unlinked_counterparty_idx')) = 3
  as reply_inbox_lookups_ready;
