-- Call Center reps work the Power Dialer: they hear a correction to a
-- name, an email, an address, or the project while the client is on the
-- line, and the dialer now has an edit panel and a call-notes box for
-- exactly that. Both writes were refused for the Call Center role -- the
-- update policy covered Office / Sales / Dispatch and the note-insert
-- policy Office / Sales / Field / Dispatch, so a Call Center rep's save
-- matched zero rows and the dialer showed the permission error.
--
-- Call Center dials the whole company queue (leads_select already lets
-- the role read every company lead), so the write gets the same company
-- scope with no per-lead carve-out: any lead they can dial, they can
-- annotate and correct. Deleting notes stays Office/Admin, untouched.
--
-- Policy text follows 0108's evaluate-once shape.

alter policy "leads_update" on public.leads
  using (
    company_id in (select public.current_role_company_ids('Office'))
    or (
      company_id in (select public.current_role_company_ids('Sales'))
      and (
        company_id not in (select public.current_lead_scoped_company_ids())
        or id in (select public.current_visible_lead_ids())
      )
    )
    or (
      company_id in (select public.current_role_company_ids('Dispatch'))
      and (dispatcher_id = (select auth.uid()) or dispatcher_id is null)
    )
    or company_id in (select public.current_role_company_ids('Call Center'))
    or company_id in (select public.current_supervisor_company_ids())
  )
  with check (
    company_id in (select public.current_role_company_ids('Office'))
    or (
      company_id in (select public.current_role_company_ids('Sales'))
      and (
        company_id not in (select public.current_lead_scoped_company_ids())
        or id in (select public.current_visible_lead_ids())
      )
    )
    or (
      company_id in (select public.current_role_company_ids('Dispatch'))
      and (dispatcher_id = (select auth.uid()) or dispatcher_id is null)
    )
    or company_id in (select public.current_role_company_ids('Call Center'))
    or company_id in (select public.current_supervisor_company_ids())
  );

alter policy "lead_notes_insert" on public.lead_notes
  with check (
    company_id in (select public.current_role_company_ids('Office'))
    or company_id in (select public.current_role_company_ids('Sales'))
    or company_id in (select public.current_role_company_ids('Field'))
    or company_id in (select public.current_role_company_ids('Dispatch'))
    or company_id in (select public.current_role_company_ids('Call Center'))
  );
