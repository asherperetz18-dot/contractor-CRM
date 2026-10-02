-- A row that names a contact belongs to that contact's company.
--
-- Every tenant table carries company_id, and RLS checks THAT column: an
-- Office user may write rows whose company_id is one of theirs. Nothing
-- checked that the contact a row points at (lead_id) is in the same
-- company. So an estimate, note, appointment or text could be filed in
-- company A under company B's contact, and admin-client code that trusts
-- the contact id -- the no-show cron moving a stage and texting the
-- customer, estimate emails reading the address -- then acted on B's
-- contact from A's row.
--
--   1. lead_in_same_company(): a BEFORE INSERT/UPDATE trigger that looks
--      up each named contact and refuses the row when its company differs
--      from the row's. SECURITY DEFINER so it sees the contact whatever
--      the caller's RLS hides (a sales rep photographing a colleague's
--      customer is a legitimate write it must not refuse). A null
--      reference is skipped; a missing contact is left to the foreign key.
--      It runs for every caller, the service role included -- the admin
--      client is exactly where an unchecked id does the damage.
--   2. apply_lead_company_checks(): stamps that trigger on every public
--      table with a company_id and a foreign key to leads(id), for each
--      such column (lead_id; documents.contact_id; the two columns of
--      lead_duplicate_dismissals). lead_trash has no foreign key -- its
--      contacts are deleted by definition -- and is left alone. Like
--      apply_billing_lock_policies() (0175), a table created later needs
--      it called again; src/lib/data/lead-company-check-migrations.test.ts
--      fails when a migration forgets.
--   3. Rows that already point across companies are counted, per table, as
--      WARNING lines -- not changed. To list them for one table:
--        select t.* from public.<table> t join public.leads l on l.id = t.lead_id
--        where l.company_id <> t.company_id;
--
-- Safe as one paste and safe to run again.
begin;

create or replace function public.lead_in_same_company()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_col text;
  v_lead uuid;
  v_lead_company uuid;
  v_row_company uuid := (to_jsonb(new) ->> 'company_id')::uuid;
begin
  foreach v_col in array tg_argv loop
    v_lead := (to_jsonb(new) ->> v_col)::uuid;
    continue when v_lead is null;
    select company_id into v_lead_company from leads where id = v_lead;
    if found and v_lead_company is distinct from v_row_company then
      raise exception 'That contact belongs to a different company (%.%).', tg_table_name, v_col
        using errcode = 'check_violation';
    end if;
  end loop;
  return new;
end
$$;

create or replace function public.apply_lead_company_checks()
returns void
language plpgsql
set search_path to 'public'
-- Only the warnings below reach the SQL editor, not a "does not exist,
-- skipping" line per table from the first run's drop trigger if exists.
set client_min_messages to 'warning'
as $$
declare
  t record;
  v_bad bigint;
  v_col text;
begin
  for t in
    select c.relname, array_agg(a.attname::text order by a.attname) as cols
    from pg_constraint k
    join pg_class c on c.oid = k.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum = k.conkey[1]
    where k.contype = 'f'
      and k.confrelid = 'public.leads'::regclass
      and array_length(k.conkey, 1) = 1
      and n.nspname = 'public'
      and c.relname <> 'leads'
      and exists (
        select 1 from pg_attribute ca
        where ca.attrelid = c.oid and ca.attname = 'company_id'
          and ca.atttypid = 'uuid'::regtype and not ca.attisdropped
      )
    group by c.relname
  loop
    execute format('drop trigger if exists lead_in_same_company on public.%I', t.relname);
    execute format(
      'create trigger lead_in_same_company before insert or update of %s, company_id on public.%I '
      'for each row execute function public.lead_in_same_company(%s)',
      (select string_agg(quote_ident(x), ', ') from unnest(t.cols) x),
      t.relname,
      (select string_agg(quote_literal(x), ', ') from unnest(t.cols) x)
    );
    foreach v_col in array t.cols loop
      execute format(
        'select count(*) from public.%I r join public.leads l on l.id = r.%I where l.company_id is distinct from r.company_id',
        t.relname, v_col
      ) into v_bad;
      if v_bad > 0 then
        raise warning '%.%: % existing row(s) point at another company''s contact', t.relname, v_col, v_bad;
      end if;
    end loop;
  end loop;
end
$$;

revoke execute on function public.apply_lead_company_checks() from public, anon, authenticated;

select public.apply_lead_company_checks();

commit;
