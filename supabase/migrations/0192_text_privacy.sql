-- Texts are private to the person they belong to (DECISIONS #113).
--
-- Every member of a company could read every text in it (0117's
-- sms_messages_select checked the company and nothing else), so the Reply
-- Inbox, a contact's Texts tab and Text Reports showed each rep every other
-- rep's conversations. The owner's rule:
--
--   * Admin, Office, Dispatch and Call Center see every text in the company.
--   * Everyone else sees only their own conversations.
--
-- A text's owner (the new owner_id):
--   * a text someone sent is theirs (sent_by);
--   * a customer's reply belongs to whoever texted that number last;
--   * with nobody to go by -- an automatic reminder, a number no one has
--     texted -- the contact's assigned rep;
--   * otherwise no one: only the four roles above see it.
--
-- New texts get their owner as they are saved (a trigger, so no app code
-- has to remember); texts already saved get it by the same rule below.
-- Until this runs, nothing changes: everyone keeps seeing every text.
--
-- Safe as one paste, and safe to run twice.

-- ── The phone-number rule ────────────────────────────────────────────

-- The digits two numbers are compared on: the last ten, or null for
-- anything shorter. Defined here word for word as 0129 has it, because
-- production never ran 0129 and the first paste of this file stopped at
-- "function public.contact_phone_key(text) does not exist". Don't run
-- 0129 to fix that: it would put back an older create_lead_for_unknown_
-- caller over 0150's. With this helper in place, 0150's one-contact-per-
-- new-caller guard (which calls it) starts working too.
create or replace function public.contact_phone_key(p_phone text)
returns text
language sql
immutable
as $$
  select case
    when length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) >= 10
      then right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10)
    else null
  end
$$;

-- ── The owner ────────────────────────────────────────────────────────

alter table public.sms_messages
  add column if not exists owner_id uuid references public.profiles (id) on delete set null;

-- What a restricted user's reads filter on.
create index if not exists sms_messages_owner_idx
  on public.sms_messages (owner_id, created_at desc)
  where owner_id is not null;

-- "Who texted this number last", for every reply. Numbers are compared on
-- their last ten digits (contact_phone_key, 0129): an outbound text keeps
-- the number as it was typed, a reply arrives as +1XXXXXXXXXX.
create index if not exists sms_messages_outbound_phone_idx
  on public.sms_messages (company_id, public.contact_phone_key(to_number), created_at desc)
  where direction = 'outbound' and sent_by is not null;

-- ── New texts ────────────────────────────────────────────────────────

-- SECURITY DEFINER: finding who texted a number last reads other people's
-- texts, which the person saving this one may no longer be allowed to see.
create or replace function public.sms_messages_set_owner()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.owner_id is not null then
    return new;
  end if;

  if new.direction = 'outbound' then
    new.owner_id := new.sent_by;
  else
    select o.sent_by into new.owner_id
    from public.sms_messages o
    where o.company_id = new.company_id
      and o.direction = 'outbound'
      and o.sent_by is not null
      and public.contact_phone_key(o.to_number) = public.contact_phone_key(new.from_number)
    order by o.created_at desc
    limit 1;
  end if;

  if new.owner_id is null and new.lead_id is not null then
    select l.assigned_to into new.owner_id
    from public.leads l
    where l.id = new.lead_id;
  end if;

  return new;
end
$$;

drop trigger if exists sms_messages_set_owner on public.sms_messages;
create trigger sms_messages_set_owner
  before insert on public.sms_messages
  for each row execute function public.sms_messages_set_owner();

-- ── Texts already saved, by the same rule ────────────────────────────

-- A text someone sent.
update public.sms_messages m
  set owner_id = m.sent_by
  where m.owner_id is null
    and m.direction = 'outbound'
    and m.sent_by is not null;

-- A reply: whoever texted that number last before it arrived.
update public.sms_messages m
  set owner_id = (
    select o.sent_by
    from public.sms_messages o
    where o.company_id = m.company_id
      and o.direction = 'outbound'
      and o.sent_by is not null
      and public.contact_phone_key(o.to_number) = public.contact_phone_key(m.from_number)
      and o.created_at <= m.created_at
    order by o.created_at desc
    limit 1
  )
  where m.owner_id is null
    and m.direction = 'inbound'
    and public.contact_phone_key(m.from_number) is not null;

-- Nobody to go by: the contact's assigned rep.
update public.sms_messages m
  set owner_id = l.assigned_to
  from public.leads l
  where m.owner_id is null
    and m.lead_id = l.id
    and l.assigned_to is not null;

-- ── Who reads them ───────────────────────────────────────────────────

-- current_role_company_ids lets Admin through every role check (0108), so
-- Admin sees every text without being named here.
alter policy "sms_messages_select" on public.sms_messages
  using (
    company_id in (select public.current_member_company_ids())
    and (
      company_id in (select public.current_role_company_ids('Office'))
      or company_id in (select public.current_role_company_ids('Dispatch'))
      or company_id in (select public.current_role_company_ids('Call Center'))
      or owner_id = (select auth.uid())
      or sent_by = (select auth.uid())
    )
  );
