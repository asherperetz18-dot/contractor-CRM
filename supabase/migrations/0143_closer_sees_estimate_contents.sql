-- The closer opened their own estimate and found it empty.
--
-- 0134 seated the closer on the lead by adding closer_id to
-- current_visible_lead_ids() and to the leads_select policy. Those are
-- what the 0117-era policies read -- estimates_select among them -- so
-- the closer sees the estimate row: number, title, total.
--
-- But everything *inside* an estimate is gated by an older rule that
-- 0134 never touched. estimate_items_select, estimate_signers_select,
-- estimate_payments_select and portal_payments_select (plus the
-- estimate_items_write USING clause from 0060) all call
-- estimate_visible_to_current_user(), which calls
-- lead_visible_to_current_user() -- last defined in 0069: assigned rep,
-- dispatcher, setter. No closer.
--
-- So a sales-scoped closer wrote an estimate at the customer's table --
-- the item inserts succeeded, because estimate_items_write's WITH CHECK
-- is only can_create_estimates -- saved it, reopened it, and every line
-- item had vanished. The scope of work was in the database the whole
-- time; the select policy was filtering it out.
--
-- The fix is the same one clause 0134 added to the other function, so
-- the two rules answer "whose lead is this" identically again. Pinned
-- by src/lib/data/lead-visibility-rules.test.ts, which fails if either
-- function's newest definition ever names a seat the other doesn't.
create or replace function lead_visible_to_current_user(check_lead_id uuid) returns boolean as $$
  select exists (
    select 1 from public.leads
    where leads.id = check_lead_id
      and (
        leads.assigned_to = auth.uid()
        or leads.dispatcher_id = auth.uid()
        or leads.closer_id = auth.uid()
        or exists (
          select 1 from public.setter_contacts
          where setter_contacts.lead_id = leads.id
            and setter_contacts.setter_id = auth.uid()
        )
      )
  );
$$ language sql stable security definer set search_path = public;

-- ── Proof rather than a success message ─────────────────────────────

-- The live function body now grants the closer seat.
select
  proname,
  prosrc like '%closer_id%' as knows_closer
from pg_proc
where proname in ('lead_visible_to_current_user', 'current_visible_lead_ids');

-- The policies this reaches: everything still gated through
-- estimate_visible_to_current_user. Expect estimate_items (select +
-- write), estimate_signers, estimate_payments, portal_payments.
select schemaname, tablename, policyname
from pg_policies
where qual like '%estimate_visible_to_current_user%'
   or with_check like '%estimate_visible_to_current_user%'
order by tablename, policyname;
