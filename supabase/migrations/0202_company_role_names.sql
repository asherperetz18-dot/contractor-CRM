-- Company role names (DECISIONS #137).
--
-- Each company can rename the team roles it shows -- "Sales" read as
-- "Technicians", "Call Center" as "Front Desk" -- in Settings › Users &
-- Roles. Only the words people read change: every permission, page rule
-- and saved assignment still uses the role itself, so a rename can never
-- change anyone's access. Admin keeps its name.
--
-- Only the roles a company renamed are stored, e.g. {"Sales": "Technicians"};
-- anything missing reads as the standard name (src/lib/role-names.ts).
-- company_profile's existing row rules apply: Office and Admin of the
-- company can change it.
--
-- Until this runs, every company shows the standard role names and the
-- settings section says so. Safe to run twice.

alter table public.company_profile
  add column if not exists role_names jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'company_profile_role_names_is_object') then
    alter table public.company_profile
      add constraint company_profile_role_names_is_object check (jsonb_typeof(role_names) = 'object');
  end if;
end
$$;

-- Check: should read true.
select exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'company_profile' and column_name = 'role_names'
) as role_names_ready;
