-- Admin was a settings-only role: it opened Admin Settings but could not
-- edit leads, events, jobs, documents, notes, tasks or send messages,
-- because 16 policies grant "Office" without also granting "Admin". An
-- Admin-only user editing a contact hit RLS, updated zero rows, and got no
-- error -- the save looked like it worked and silently did nothing.
--
-- Rather than rewriting all 16 policies (and every future one), Admin now
-- satisfies any role check within its own company. That is what "Admin"
-- is expected to mean, and it keeps the grant in one auditable place.
--
-- Safe against the sales-visibility logic: is_sales_only() inspects the
-- roles array directly and explicitly excludes Admin, so an Admin is still
-- never treated as sales-restricted.

begin;

create or replace function has_role_in_company(check_role app_role, check_company_id uuid)
returns boolean as $$
  select exists (
    select 1 from public.company_members
    where profile_id = auth.uid()
      and company_id = check_company_id
      and status = 'Active'
      and (check_role = any(roles) or 'Admin' = any(roles))
  );
$$ language sql stable security definer set search_path = public;

-- Deleting leads is checked directly rather than through the helper above,
-- so Admin has to be named explicitly here too.
create or replace function can_delete_lead_in_company(check_company_id uuid)
returns boolean as $$
  select exists (
    select 1 from public.company_members
    where profile_id = auth.uid()
      and company_id = check_company_id
      and status = 'Active'
      and (
        'Office' = any(roles)
        or 'Admin' = any(roles)
        or ('Sales' = any(roles) and can_delete_leads = true)
      )
  );
$$ language sql stable security definer set search_path = public;

commit;
