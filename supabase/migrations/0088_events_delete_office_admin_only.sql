-- Deleting an appointment becomes Office and Admin only.
--
-- An appointment is the evidence a trip was made: the show rate, the
-- follow-up cron and a rep's commission all read it. Removing one is an
-- office decision, not something a crew does from the field. Cancelled
-- remains the tool for "it isn't happening" and it keeps the history.
--
-- The rule this replaces was inherited from the old events_write policy,
-- which covered insert, update and delete together:
--
--   has_role_in_company('Office', company_id)
--   or has_role_in_company('Field', company_id)
--   or (has_role_in_company('Sales', company_id)
--       and (not is_sales_only(company_id) or assigned_to = auth.uid()))
--
-- Two grants go with this change:
--
--   Field  -- what was asked for.
--   Sales  -- their own appointments, under that third clause. Dropped
--            as well because it has never been reachable: the Delete
--            button has always been gated on canEditSchedule, which does
--            not include Sales. A permission nothing can exercise is one
--            nobody has audited.
--
-- Admin is not lost by dropping Field: has_role_in_company returns true
-- for any role check when the member holds Admin (see 0047). It is named
-- explicitly here anyway, so this policy still says what it means if that
-- shortcut is ever removed.
--
-- Only the USING expression is set: a delete policy has no WITH CHECK.
-- Altered rather than dropped and recreated, because events_delete is the
-- only policy on this table that permits DELETE -- confirmed against
-- pg_policies on the live database -- so narrowing it narrows the whole
-- permission, with no second policy quietly granting it back.
alter policy "events_delete" on public.events
  using (
    has_role_in_company('Office'::app_role, company_id)
    or has_role_in_company('Admin'::app_role, company_id)
  );
