-- The closer on a lead: the person who runs the appointment and writes
-- the estimate, alongside the rep who owns the contact.
--
-- The money side of this already exists. A signed contract carries
-- sales_rep_1/sales_rep_2 with a basis-point share each (0086), paid out
-- of net profit once the job is settled. What does not exist is anybody
-- being named before the signature: the second rep appears only on the
-- contract, so ahead of the sale there is no closer to give access to,
-- nothing to seed the split from, and the contact sits in exactly one
-- person's portfolio.
--
-- This adds the closer where the work actually starts -- on the lead --
-- and nothing else. The split arithmetic stays where it already lives.

-- ── The closer, and their share ─────────────────────────────────────
--
-- closer_bp is nullable on purpose: null means "use the company
-- default", so changing the default later moves every lead that never
-- had a figure typed on it. A stored number is somebody's decision about
-- this one job and is left alone.
--
-- Basis points, like every other share in this schema (500 = 5%). Stored
-- as a share of NET PROFIT, which is the way the rate was described and
-- the same base the rep commission already uses.
alter table public.leads
  add column if not exists closer_id uuid references public.profiles(id);
alter table public.leads
  add column if not exists closer_bp int;

comment on column public.leads.closer_id is
  'The person who ran the appointment and wrote the estimate. The rep who owns the contact is assigned_to; this is the second chair, and it is what grants them access to the lead.';
comment on column public.leads.closer_bp is
  'This lead''s closer share of net profit, in basis points. Null means use company_profile.default_closer_bp.';

-- The company-wide starting figure. 5%, as agreed.
alter table public.company_profile
  add column if not exists default_closer_bp int not null default 500;

comment on column public.company_profile.default_closer_bp is
  'Starting closer share of net profit for a new lead, in basis points. 500 = 5%. Overridden per lead by leads.closer_bp.';

-- Reads are "the leads where I am the closer", so the index matches that
-- rather than scanning. Partial: almost every lead has no closer, and
-- there is no query that wants those rows by this column.
create index if not exists leads_closer_id_idx
  on public.leads (closer_id)
  where closer_id is not null;

-- ── Access ──────────────────────────────────────────────────────────
--
-- One function, not a policy per table. current_visible_lead_ids() is
-- already what decides whether a lead-scoped user can see a contact's
-- notes, tasks and estimates (0108, 0117) -- so adding the closer here
-- gives them the lead, its history and the right to write an estimate on
-- it, in one place, with no policy left behind out of step with the
-- others.
--
-- A closer with no wider role could otherwise see the appointment they
-- were booked onto and not the customer it belongs to.
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
$$;

-- leads_select spells its conditions out inline rather than calling the
-- function above, so it needs the same clause added by hand. Without
-- this the closer could read the lead's notes but not the lead.
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
    )
  );

-- ── Proof rather than a success message ─────────────────────────────

-- Both columns landed, and the default did.
select
  (select count(*) from information_schema.columns
    where table_name = 'leads'
      and column_name in ('closer_id', 'closer_bp')) as lead_cols,
  (select count(*) from information_schema.columns
    where table_name = 'company_profile'
      and column_name = 'default_closer_bp') as company_cols;

-- Every company starts at 5%. Any row reading something else here was
-- set by hand after this ran.
select company_id, default_closer_bp from public.company_profile;

-- Nothing has a closer yet, and nothing has an override. This is a new
-- column on 2,218 existing leads: both counts must be zero, or something
-- wrote to it before anyone could have chosen to.
select
  count(*) filter (where closer_id is not null) as with_closer,
  count(*) filter (where closer_bp is not null) as with_override,
  count(*) as total_leads
from public.leads;
