-- One contact per new caller, even when two calls land in the same
-- second.
begin;

-- ====================================================================
-- The importer creates a contact by reading first ("does anyone have
-- this number?") and inserting second. Two CallRail deliveries for the
-- same new number, or a delivery and the 6-hour sweep, can both finish
-- the read before either insert lands -- so both see "nobody" and both
-- insert. That pair is where every runaway duplicate started: once a
-- number sits on two cards the matcher can no longer name one owner.
--
-- The obvious guard, a unique rule on the phone number, is wrong for
-- this book: one number genuinely sits on four different names, put
-- there by hand. Nothing here stops a person entering that. What it
-- stops is the IMPORTER doing it behind their back.
--
-- So the read and the insert happen inside one transaction holding an
-- advisory lock keyed on (company, number). The second caller waits,
-- then sees the contact the first one made and is handed that instead
-- of making another.
--
-- Creates two new functions and touches no existing table, column or
-- row. Safe to run more than once.
-- ====================================================================

-- The digits two numbers are compared on: the last ten, or null for
-- anything shorter. Same rule as normalizePhone/phoneKey in the app --
-- "+1 323-806-7609", "323-806-7609" and "1 (323) 806 7609" are one
-- number.
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

-- Creates the contact for a caller nobody has -- or, if somebody turns
-- out to have them, hands back the contact that already exists.
--
-- The insert is column-for-column what the app has been doing from
-- TypeScript since the CallRail integration shipped; the only new part
-- is the lock and the re-read above it.
--
-- Returns one row:
--   lead_id  the contact to file the call against, null when the number
--            is on several contacts (the app leaves the call under the
--            number alone rather than guessing an owner)
--   created  true only when this call actually inserted the row, so the
--            app knows whether to send the "new lead" alert
--   matched  how many contacts already held the number
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

-- SECURITY DEFINER means this runs as the owner and skips row security,
-- so it must not be callable by a signed-in browser: Postgres grants
-- EXECUTE to PUBLIC on a new function by default. Only the server-side
-- importer (service role) may use it.
revoke all on function public.create_lead_for_unknown_caller(uuid, text, text, text, text, text, text) from public;
revoke all on function public.create_lead_for_unknown_caller(uuid, text, text, text, text, text, text) from anon;
revoke all on function public.create_lead_for_unknown_caller(uuid, text, text, text, text, text, text) from authenticated;
grant execute on function public.create_lead_for_unknown_caller(uuid, text, text, text, text, text, text) to service_role;

commit;
