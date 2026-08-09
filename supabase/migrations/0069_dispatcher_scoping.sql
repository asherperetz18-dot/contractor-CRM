begin;

-- A dispatcher owns a lead from arrival until it sells, and is paid a
-- percentage of what it sells for. That only works if the lead is theirs
-- -- so Dispatch users stop seeing the whole company's book and see
-- their own leads plus whatever nobody has claimed yet.

-- Restricted to their own leads because they are a dispatcher.
-- Office and Admin are excluded: they run the business and need the
-- whole picture. Other roles alongside Dispatch do not widen this --
-- a dispatcher who also answers phones is still a dispatcher.
create or replace function is_dispatch_scoped(check_company_id uuid) returns boolean as $$
  select exists (
    select 1 from public.company_members
    where profile_id = auth.uid()
      and company_id = check_company_id
      and status = 'Active'
      and 'Dispatch' = any(roles::text[])
      and not (roles::text[] && array['Office', 'Admin'])
  );
$$ language sql stable security definer set search_path = public;

-- "Limited to leads that are mine", whatever the reason.
--
-- is_sales_only() is redefined to delegate here rather than editing the
-- ten policies that already call it across leads, events, estimates and
-- estimate items. Adding dispatch to each of those by hand is precisely
-- how one gets missed, and a missed policy here does not fail loudly --
-- it quietly shows a dispatcher another dispatcher's pipeline.
--
-- The name is kept because those policies reference it; it now means
-- "scoped to own leads" rather than literally "is a Sales user".
create or replace function is_lead_scoped(check_company_id uuid) returns boolean as $$
  select exists (
    select 1 from public.company_members
    where profile_id = auth.uid()
      and company_id = check_company_id
      and status = 'Active'
      and 'Sales' = any(roles::text[])
      and not (roles::text[] && array['Office', 'Admin', 'Field', 'Call Center', 'Dispatch'])
  ) or public.is_dispatch_scoped(check_company_id);
$$ language sql stable security definer set search_path = public;

create or replace function is_sales_only(check_company_id uuid) returns boolean as $$
  select public.is_lead_scoped(check_company_id);
$$ language sql stable security definer set search_path = public;

-- A lead is "mine" if I sell it or if I dispatched it. Estimates, events
-- and notes all hang off this, so a dispatcher sees the whole job they
-- are being paid on rather than a lead record with nothing attached.
create or replace function lead_visible_to_current_user(check_lead_id uuid) returns boolean as $$
  select exists (
    select 1 from public.leads
    where leads.id = check_lead_id
      and (
        leads.assigned_to = auth.uid()
        or leads.dispatcher_id = auth.uid()
        or exists (
          select 1 from public.setter_contacts
          where setter_contacts.lead_id = leads.id
            and setter_contacts.setter_id = auth.uid()
        )
      )
  );
$$ language sql stable security definer set search_path = public;

-- The pool. Unclaimed leads stay visible to every dispatcher so there is
-- something to claim; the moment one is claimed it leaves everyone
-- else's list. Deliberately only on the leads table -- an unclaimed lead
-- should not expose its estimates or appointments to the whole team.
drop policy if exists "leads_select" on leads;
create policy "leads_select" on leads for select
  to authenticated using (
    is_member_of_company(company_id)
    and (
      not is_lead_scoped(company_id)
      or assigned_to = auth.uid()
      or dispatcher_id = auth.uid()
      or (is_dispatch_scoped(company_id) and dispatcher_id is null)
      or exists (
        select 1 from setter_contacts
        where setter_contacts.lead_id = leads.id
          and setter_contacts.setter_id = auth.uid()
      )
    )
  );

commit;
