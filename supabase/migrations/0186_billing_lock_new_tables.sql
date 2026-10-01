-- Stamp the unpaid-subscription lock (0175, DECISIONS #075) onto the
-- company tables added since without it: lead_file_deletions (0182) and
-- lead_shared_notes (0183). Without it, a company whose subscription
-- has lapsed is locked out of the app but could still read those two
-- tables through the API. Screens were never affected.
--
-- apply_billing_lock_policies() re-stamps every RLS-protected public
-- table with a uuid company_id (drop + create), and the restrictive
-- policy only narrows what a lapsed company's members can see -- nobody
-- else's access changes. src/lib/billing/billing-lock-migrations.test.ts
-- now fails when a migration adds a company table without this call.
--
-- Needs 0175 (and 0182/0183 for those two tables to exist). Safe as one
-- paste and safe to run any number of times.

select public.apply_billing_lock_policies();

-- Verify: every company table carries billing_lock (expect 0 rows).
select c.relname as table_missing_billing_lock
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a on a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
  and c.relrowsecurity
  and a.atttypid = 'uuid'::regtype
  and c.relname not in ('company_members', 'profiles', 'company_billing', 'signup_invites')
  and not exists (select 1 from pg_policy p where p.polrelid = c.oid and p.polname = 'billing_lock')
order by 1;
