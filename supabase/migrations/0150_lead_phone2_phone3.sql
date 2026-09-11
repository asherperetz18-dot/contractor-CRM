-- Two more phone numbers on a contact: phone2 and phone3.
--
-- Bought cold-call lists often carry up to three numbers for the same
-- person. Until now the card had one phone field (plus the second
-- CONTACT's phone, which is a different person), so the extra numbers
-- were either dropped on import or pasted into notes where nothing
-- could dial or match them.
--
-- The caller matcher must see the new columns too: a prospect ringing
-- back on their second number would otherwise look like a stranger,
-- and the CallRail importer would mint a duplicate contact -- the
-- exact runaway that migration 0129 exists to stop. So the
-- create_lead_for_unknown_caller read is widened to all four columns.
-- The TypeScript side (src/lib/data/phone-match.ts) is widened in the
-- same change.
--
-- Idempotent; safe as one paste and safe to run twice.

begin;

alter table leads
  add column if not exists phone2 text,
  add column if not exists phone3 text;

comment on column leads.phone2 is
  'Second phone number for the same contact person (cold-call lists carry up to three).';
comment on column leads.phone3 is
  'Third phone number for the same contact person.';

-- Same function as 0129, with the read widened to phone2/phone3.
create or replace function public.create_lead_for_unknown_caller(
  p_company_id uuid,
  p_phone text,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_source text,
  p_notes text
)
returns table (lead_id uuid, created boolean, matched integer)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_key text := public.contact_phone_key(p_phone);
  v_ids uuid[];
  v_new uuid;
begin
  if v_key is not null then
    -- Transaction-scoped on purpose: released on commit, which keeps it
    -- correct under Supabase's transaction pooling. A session-level
    -- pg_advisory_lock would be left behind on a pooled connection.
    perform pg_advisory_xact_lock(hashtext(p_company_id::text), hashtext(v_key));

    -- Read INSIDE the lock. This is the whole point: whoever waited
    -- here sees what the winner wrote.
    select array_agg(l.id) into v_ids
    from public.leads l
    where l.company_id = p_company_id
      and (
        public.contact_phone_key(l.phone) = v_key
        or public.contact_phone_key(l.phone2) = v_key
        or public.contact_phone_key(l.phone3) = v_key
        or public.contact_phone_key(l.second_contact_phone) = v_key
      );

    if array_length(v_ids, 1) = 1 then
      return query select v_ids[1], false, 1;
      return;
    elsif array_length(v_ids, 1) > 1 then
      return query select null::uuid, false, array_length(v_ids, 1);
      return;
    end if;
  end if;

  -- Nobody has this number (or there is no usable number at all, which
  -- is a form fill with only an email). Same insert the app did before.
  insert into public.leads (
    contact_type, first_name, last_name, phone, email, notes, stage, source, company_id
  ) values (
    'Individual',
    nullif(p_first_name, ''),
    nullif(p_last_name, ''),
    nullif(p_phone, ''),
    nullif(p_email, ''),
    p_notes,
    'Unsorted',
    p_source,
    p_company_id
  )
  returning id into v_new;

  return query select v_new, true, 0;
end;
$$;

-- create or replace keeps the 0129 grants (service_role only), but
-- restate them so this file also stands alone.
revoke all on function public.create_lead_for_unknown_caller(uuid, text, text, text, text, text, text) from public;
revoke all on function public.create_lead_for_unknown_caller(uuid, text, text, text, text, text, text) from anon;
revoke all on function public.create_lead_for_unknown_caller(uuid, text, text, text, text, text, text) from authenticated;
grant execute on function public.create_lead_for_unknown_caller(uuid, text, text, text, text, text, text) to service_role;

commit;
