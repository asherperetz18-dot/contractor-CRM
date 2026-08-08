begin;

-- A Dispatch role: takes inbound leads, assigns them to reps, books and
-- confirms appointments, works the schedule. Sees everyone's leads,
-- touches no money.
alter type app_role add value if not exists 'Dispatch';

-- is_sales_only() is what restricts a user to their OWN leads. It is
-- written as "has Sales and none of the broader roles", so every new role
-- has to be added to that exclusion list or it silently does nothing:
-- somebody with Sales + Dispatch would keep seeing only their own leads,
-- which defeats the whole point of dispatching.
--
-- Compared as text[] rather than with app_role literals on purpose --
-- Postgres will not let a value added by ALTER TYPE in this transaction
-- be used as a literal until it commits, and this keeps the whole change
-- in one script.
create or replace function is_sales_only(check_company_id uuid) returns boolean as $$
  select exists (
    select 1 from public.company_members
    where profile_id = auth.uid()
      and company_id = check_company_id
      and status = 'Active'
      and 'Sales' = any(roles::text[])
      and not (roles::text[] && array['Office', 'Admin', 'Field', 'Call Center', 'Dispatch'])
  );
$$ language sql stable security definer set search_path = public;

commit;
