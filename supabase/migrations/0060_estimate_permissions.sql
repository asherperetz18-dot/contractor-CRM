begin;

-- Per-user estimate permissions, alongside can_delete_leads on the same
-- table. Estimates carry prices, margins and signed dollar commitments,
-- so "can this person open one" and "can this person write one" are
-- decisions an owner should be able to make per person rather than
-- inheriting from a role.
alter table company_members
  add column if not exists can_view_estimates boolean not null default false,
  add column if not exists can_create_estimates boolean not null default false;

-- Backfill to exactly today's behaviour so nobody loses access the moment
-- this runs. Right now anyone with Office, Admin or Sales can reach and
-- write estimates (canEditDispatch), so those three keep both rights and
-- everyone else starts without them. Defaulting the columns to false and
-- skipping this would silently lock every rep out of the module.
update company_members
   set can_view_estimates = true,
       can_create_estimates = true
 where roles && array['Office', 'Admin', 'Sales']::app_role[];

-- Field and Call Center can see estimates but not write them: a field
-- crew often needs to read the scope of work they are about to perform.
update company_members
   set can_view_estimates = true
 where roles && array['Field']::app_role[]
   and can_view_estimates = false;

-- Office and Admin always hold both regardless of the flags, mirroring
-- can_delete_leads -- an owner must not be able to lock themselves out of
-- their own money. The flags only decide the other roles.
create or replace function can_view_estimates_in_company(check_company_id uuid)
returns boolean as $$
  select exists (
    select 1 from public.company_members m
    where m.profile_id = auth.uid()
      and m.company_id = check_company_id
      and m.status = 'Active'
      and (
        m.can_view_estimates
        or m.roles && array['Office', 'Admin']::app_role[]
      )
  );
$$ language sql stable security definer set search_path = public;

create or replace function can_create_estimates_in_company(check_company_id uuid)
returns boolean as $$
  select exists (
    select 1 from public.company_members m
    where m.profile_id = auth.uid()
      and m.company_id = check_company_id
      and m.status = 'Active'
      and (
        m.can_create_estimates
        or m.roles && array['Office', 'Admin']::app_role[]
      )
  );
$$ language sql stable security definer set search_path = public;

-- Enforced in the database, not only in the UI. A hidden button is not a
-- permission -- the row has to be unreachable.
drop policy "estimates_select" on estimates;
create policy "estimates_select" on estimates for select
  to authenticated using (
    is_member_of_company(company_id)
    and can_view_estimates_in_company(company_id)
    and (not is_sales_only(company_id) or lead_visible_to_current_user(lead_id))
  );

drop policy "estimates_insert" on estimates;
create policy "estimates_insert" on estimates for insert
  to authenticated with check (can_create_estimates_in_company(company_id));

drop policy "estimates_update" on estimates;
create policy "estimates_update" on estimates for update
  to authenticated using (
    can_create_estimates_in_company(company_id)
    and (not is_sales_only(company_id) or lead_visible_to_current_user(lead_id))
  );

-- Line items and signers follow the parent document: being able to read
-- an estimate but not its prices, or write items onto one you cannot
-- create, are both incoherent.
drop policy "estimate_items_select" on estimate_items;
create policy "estimate_items_select" on estimate_items for select
  to authenticated using (
    is_member_of_company(company_id)
    and can_view_estimates_in_company(company_id)
    and estimate_visible_to_current_user(estimate_id)
  );

drop policy "estimate_items_write" on estimate_items;
create policy "estimate_items_write" on estimate_items for all
  to authenticated using (
    can_create_estimates_in_company(company_id)
    and estimate_visible_to_current_user(estimate_id)
  )
  with check (can_create_estimates_in_company(company_id));

drop policy "estimate_signers_select" on estimate_signers;
create policy "estimate_signers_select" on estimate_signers for select
  to authenticated using (
    is_member_of_company(company_id)
    and can_view_estimates_in_company(company_id)
    and estimate_visible_to_current_user(estimate_id)
  );

drop policy "estimate_signers_write" on estimate_signers;
create policy "estimate_signers_write" on estimate_signers for all
  to authenticated using (
    can_create_estimates_in_company(company_id)
    and estimate_visible_to_current_user(estimate_id)
  )
  with check (can_create_estimates_in_company(company_id));

commit;
