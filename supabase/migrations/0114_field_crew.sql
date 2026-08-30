-- Field crew works the Projects page: receipts and photos, no money.
--
-- The Field grant is deliberately NOT a widening of
-- can_manage_costs_in_company. That function guards the job_expenses
-- FOR ALL policy and vendors_write, so putting Field in it would hand
-- the crew select/update/delete over every expense (amounts included)
-- and the vendor list. Instead Field gets exactly two policies of its
-- own on job_expenses: INSERT, and SELECT limited to rows they created
-- -- the latter because the app's insert uses RETURNING, which demands
-- select visibility of the new row, and because reading back your own
-- receipt is not a money view.
--
-- Second change: the lead_files insert policy learns about the roles
-- added since it was written. Admin-only members and Production crew
-- could read and delete job files but not add one, which the new
-- per-job Photos button would have turned from a latent gap into a
-- daily error.
--
-- Every role named below has existed for many releases, so this file is
-- safe as one paste in the SQL editor. Idempotent; safe to run twice.

begin;

drop policy if exists "job_expenses_field_insert" on job_expenses;
create policy "job_expenses_field_insert" on job_expenses for insert
  to authenticated with check (exists (
    select 1 from public.company_members m
    where m.profile_id = auth.uid()
      and m.company_id = job_expenses.company_id
      and m.status = 'Active'
      and 'Field' = any(m.roles::text[])
  ));

drop policy if exists "job_expenses_field_select_own" on job_expenses;
create policy "job_expenses_field_select_own" on job_expenses for select
  to authenticated using (
    created_by = auth.uid()
    and exists (
      select 1 from public.company_members m
      where m.profile_id = auth.uid()
        and m.company_id = job_expenses.company_id
        and m.status = 'Active'
        and 'Field' = any(m.roles::text[])
    )
  );

drop policy if exists "lead_files_insert" on lead_files;
create policy "lead_files_insert" on lead_files for insert
  to authenticated with check (
    has_role_in_company('Office', company_id)
    or has_role_in_company('Sales', company_id)
    or has_role_in_company('Field', company_id)
    or has_role_in_company('Admin', company_id)
    or has_role_in_company('Production', company_id)
  );

commit;
