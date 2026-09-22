-- People stamped on a contract keep seeing it, forever.
--
-- A returning client's second job gets a new team: the office reseats
-- the contact's Assigned Rep / Partner / Closer, and the new people
-- take over. The first contract is financially safe -- its Sales team
-- was stamped at signature (0135/0153/0163) and reseating the contact
-- never restates it -- but its *visibility* was not: a sales-scoped
-- rep's access to a contract rides on holding the CONTACT, so the old
-- team lost sight of their own signed contract, its payment progress,
-- and the commission line still owed to them. The money stayed owed;
-- they just couldn't watch it any more. (Reps who sat on an old
-- appointment kept access through 0152's appointment grant; a closer
-- who never held an appointment seat lost everything.)
--
-- The rule this adds: a seat stamped on a contract's own Sales team --
-- sales_rep_1, sales_rep_2, or its closer seat -- grants the contract's
-- customer the same way every lead seat does. Signed the paper, keep
-- the paper.
--
-- Same three places as every seat before it (0134, 0143, 0152, 0163):
-- both SQL visibility rules and leads_select, together, pinned level by
-- src/lib/data/lead-visibility-rules.test.ts. The estimates read goes
-- through a SECURITY DEFINER helper, exactly like
-- current_appointment_lead_ids (0159): leads_select must never subquery
-- another RLS-governed table inline, or the policy rewriter recurses
-- ("infinite recursion detected") the way 0152's events clause did.
--
-- Idempotent; safe as one paste and safe to run twice.

-- ── The helper: whose contracts seat me ─────────────────────────────

create or replace function public.current_contract_seat_lead_ids()
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select e.lead_id
  from public.estimates e
  where e.lead_id is not null
    and (e.sales_rep_1 = (select auth.uid())
      or e.sales_rep_2 = (select auth.uid())
      or e.closer_id = (select auth.uid()))
$$;

comment on function public.current_contract_seat_lead_ids() is
  'Leads whose contracts seat the caller on their stamped Sales team (sales_rep_1/2 or closer seat). Grants visibility that survives the contact being reseated for a later job: signed the paper, keep the paper.';

-- The reads are point lookups by person; almost every estimate has few
-- or no seats set, so the indexes carry only the rows that do.
-- (estimates_closer_id_idx already exists from 0153.)
create index if not exists estimates_sales_rep_1_idx
  on public.estimates (sales_rep_1)
  where sales_rep_1 is not null;
create index if not exists estimates_sales_rep_2_idx
  on public.estimates (sales_rep_2)
  where sales_rep_2 is not null;

-- ── The three visibility rules, restated from 0163 plus the grant ───

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
     or l.partner_rep_id = (select auth.uid())
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
     or l.id in (select public.current_contract_seat_lead_ids())
$$;

create or replace function lead_visible_to_current_user(check_lead_id uuid) returns boolean as $$
  select exists (
    select 1 from public.leads
    where leads.id = check_lead_id
      and (
        leads.assigned_to = auth.uid()
        or leads.partner_rep_id = auth.uid()
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
        or leads.id in (select public.current_contract_seat_lead_ids())
      )
  );
$$ language sql stable security definer set search_path = public;

-- 0163's leads_select with the stamped-seat grant added; the
-- appointment grant stays behind its helper (0159), and the new grant
-- goes through its own helper for the same reason. Everything else
-- restated verbatim.
alter policy "leads_select" on public.leads
  using (
    company_id in (select public.current_member_company_ids())
    and (
      company_id not in (select public.current_lead_scoped_company_ids())
      or assigned_to = (select auth.uid())
      or partner_rep_id = (select auth.uid())
      or dispatcher_id = (select auth.uid())
      or closer_id = (select auth.uid())
      or (
        company_id in (select public.current_dispatch_scoped_company_ids())
        and dispatcher_id is null
      )
      or id in (select public.current_setter_lead_ids())
      or id in (select public.current_appointment_lead_ids())
      or id in (select public.current_contract_seat_lead_ids())
    )
  );

-- ── Proof rather than a success message ─────────────────────────────

-- The helper exists and bypasses estimates RLS (prosecdef = true), so
-- it cannot recurse the way an inline subquery would.
select proname, prosecdef as security_definer
from pg_proc
where proname = 'current_contract_seat_lead_ids';

-- All three rules carry the grant, together.
select proname, prosrc like '%current_contract_seat_lead_ids%' as knows_contract_seats
from pg_proc
where proname in ('lead_visible_to_current_user', 'current_visible_lead_ids');
select polname, pg_get_expr(polqual, polrelid) like '%current_contract_seat_lead_ids%' as knows_contract_seats
from pg_policy
where polname = 'leads_select';

-- How many people this actually protects: distinct seats on signed
-- contracts who hold no seat on the contract's lead today. These are
-- the ones who would have lost sight of their own money on a reseat.
select count(*) as stamped_seats_not_on_the_lead
from (
  select e.lead_id, s.seat_id
  from public.estimates e
  cross join lateral (values (e.sales_rep_1), (e.sales_rep_2), (e.closer_id)) as s(seat_id)
  where e.status = 'Signed' and s.seat_id is not null
) seats
join public.leads l on l.id = seats.lead_id
where seats.seat_id is distinct from l.assigned_to
  and seats.seat_id is distinct from l.partner_rep_id
  and seats.seat_id is distinct from l.closer_id
  and seats.seat_id is distinct from l.dispatcher_id;
