-- 0099: see chat -- lead_tasks policies learn about Dispatch
-- Supervisors (insert/update/select).
alter policy "lead_tasks_insert" on lead_tasks
  with check (
    has_role_in_company('Office', company_id)
    or (has_role_in_company('Sales', company_id) and (
      not is_sales_only(company_id)
      or lead_visible_to_current_user(lead_id)
      or assigned_to = auth.uid()
    ))
    or (has_role_in_company('Dispatch', company_id) and lead_visible_to_current_user(lead_id))
    or public.is_dispatch_supervisor(company_id)
  );

alter policy "lead_tasks_update" on lead_tasks
  using (
    has_role_in_company('Office', company_id)
    or (has_role_in_company('Sales', company_id) and (
      not is_sales_only(company_id)
      or lead_visible_to_current_user(lead_id)
      or assigned_to = auth.uid()
    ))
    or (has_role_in_company('Dispatch', company_id) and lead_visible_to_current_user(lead_id))
    or public.is_dispatch_supervisor(company_id)
  )
  with check (
    has_role_in_company('Office', company_id)
    or (has_role_in_company('Sales', company_id) and (
      not is_sales_only(company_id)
      or lead_visible_to_current_user(lead_id)
      or assigned_to = auth.uid()
    ))
    or (has_role_in_company('Dispatch', company_id) and lead_visible_to_current_user(lead_id))
    or public.is_dispatch_supervisor(company_id)
  );

alter policy "lead_tasks_select" on lead_tasks
  using (
    is_member_of_company(company_id)
    and (
      not is_sales_only(company_id)
      or lead_visible_to_current_user(lead_id)
      or public.is_dispatch_supervisor(company_id)
    )
  );
