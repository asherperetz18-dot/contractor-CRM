-- Both reps on the appointment see the lead.
--
-- An appointment carries two seats: assigned_to and, since 0039, an
-- optional second_assigned_to for a job that takes two people. The
-- second chair gets the appointment texts, shows on the calendar --
-- and, if they are a sales-scoped rep, cannot open the customer the
-- appointment is for. Same hole 0134 closed for the closer: they can
-- see the visit they were booked onto and not the lead it belongs to,
-- so the estimate they are working, the contract and their commission
-- line all read as missing.
--
-- The fix is the same shape as 0134/0143: one clause, added to BOTH
-- lead-visibility rules and to leads_select, so a rep named on any of
-- the lead's appointments -- either chair -- holds the lead like the
-- assigned rep, dispatcher and closer already do. The pinned test
-- (src/lib/data/lead-visibility-rules.test.ts) now requires the
-- events clause in both functions, so the next edit keeps them level.
--
-- Sending is NOT widened by this: on a lead with a closer, the closer
-- review hold in src/lib/actions/estimates.ts still decides who may
-- take a document out of Draft. This grants reading and drafting only.

create or replace function public.current_visible_lead_ids()
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select l.id
  from public.leads l
  where l.assigned_to = (select auth.uid())
     or l.dispatcher_id = (select auth.uid())
     or l.closer_id = (select auth.uid())
     or l.id in (
       select sc.lead_id from public.setter_contacts sc
       where sc.setter_id = (select auth.uid())
     )
     or l.id in (
       select e.lead_id from public.events e
       where e.lead_id is not null
         and (e.assigned_to = (select auth.uid())
           or e.second_assigned_to = (select auth.uid()))
     )
$$;

-- The per-row twin, still gating estimate_items, estimate_signers,
-- estimate_payments and portal_payments through
-- estimate_visible_to_current_user. Same clause, same reasoning:
-- an estimate row a rep can open must never hide its own line items.
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
        or exists (
          select 1 from public.events
          where events.lead_id = leads.id
            and (events.assigned_to = auth.uid()
              or events.second_assigned_to = auth.uid())
        )
      )
  );
$$ language sql stable security definer set search_path = public;

-- leads_select spells its conditions out inline (0134), so the same
-- clause goes in by hand here too.
alter policy "leads_select" on public.leads
  using (
    company_id in (select public.current_member_company_ids())
    and (
      company_id not in (select public.current_lead_scoped_company_ids())
      or assigned_to = (select auth.uid())
      or dispatcher_id = (select auth.uid())
      or closer_id = (select auth.uid())
      or (
        company_id in (select public.current_dispatch_scoped_company_ids())
        and dispatcher_id is null
      )
      or id in (select public.current_setter_lead_ids())
      or id in (
        select e.lead_id from public.events e
        where e.lead_id is not null
          and (e.assigned_to = (select auth.uid())
            or e.second_assigned_to = (select auth.uid()))
      )
    )
  );

-- The reads these clauses make are "the appointments where I hold a
-- seat" -- point lookups by person, not scans of the calendar. Partial
-- on lead_id: an event without a lead grants nothing.
create index if not exists events_assigned_to_lead_idx
  on public.events (assigned_to)
  where lead_id is not null;
create index if not exists events_second_assigned_to_lead_idx
  on public.events (second_assigned_to)
  where second_assigned_to is not null and lead_id is not null;

-- ── Proof rather than a success message ─────────────────────────────

-- Both functions now grant the appointment seats, together.
select
  proname,
  prosrc like '%second_assigned_to%' as knows_second_chair
from pg_proc
where proname in ('lead_visible_to_current_user', 'current_visible_lead_ids');

-- The policy carries the clause too.
select polname, pg_get_expr(polqual, polrelid) like '%second_assigned_to%' as knows_second_chair
from pg_policy
where polname = 'leads_select';

-- How many leads this actually opens up: appointments whose second
-- chair is neither the lead's assigned rep, dispatcher nor closer.
-- These are the people who could see the visit but not the customer.
select count(distinct e.lead_id) as leads_newly_visible_to_a_second_chair
from public.events e
join public.leads l on l.id = e.lead_id
where e.second_assigned_to is not null
  and e.second_assigned_to is distinct from l.assigned_to
  and e.second_assigned_to is distinct from l.dispatcher_id
  and e.second_assigned_to is distinct from l.closer_id;
