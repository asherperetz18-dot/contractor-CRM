-- The partner rep: two salespeople, one sale.
--
-- A job that takes two reps had no honest shape. The second person
-- existed only as an appointment seat (events.second_assigned_to,
-- 0039): they could drive out, and since 0152 they can open the lead --
-- but the sale was never theirs. leads.assigned_to holds one name, the
-- Salespeople grid tallies by that one name, and the signature seeding
-- (0153) seats that one name on the contract's money.
--
-- This adds the partnership where the ownership lives -- on the lead:
--
--   partner_rep_id   the second rep, sharing the sale with assigned_to
--
-- and wires the three places a seat means anything:
--
--   1. Visibility: the partner holds the lead like the owner does.
--   2. The sale: the Salespeople grid credits both -- each gets the
--      lead and the Won notch, the value splits half and half, so the
--      grid's total still adds to what the company actually sold.
--   3. The money: at signature the partner takes rep seat two at an
--      even split of the rep share (the closer's cut, 0153, stays off
--      the top and untouched). The office adjusts shares on the panel.
--
-- The closer remains deliberately different: a follower with a cut,
-- never a holder of the sale. That is the line this whole design draws.

alter table public.leads
  add column if not exists partner_rep_id uuid references public.profiles(id);

comment on column public.leads.partner_rep_id is
  'The second rep on a partnership job (0163). Shares the sale with assigned_to: both hold the lead, both get sale credit at half value, and at signature they split the rep share of the commission pool. Distinct from the closer, who follows the job with a cut but never holds the sale.';

-- Reads are "the leads where I am the partner"; almost every lead has
-- no partner, so the index carries only the ones that do.
create index if not exists leads_partner_rep_id_idx
  on public.leads (partner_rep_id)
  where partner_rep_id is not null;

-- ── 1. Visibility ────────────────────────────────────────────────────
--
-- Same three places as every seat before it (0134, 0143, 0152): both
-- SQL rules and the leads_select policy, together, pinned level by
-- src/lib/data/lead-visibility-rules.test.ts.

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
      )
  );
$$ language sql stable security definer set search_path = public;

-- 0159's leads_select with the partner seat added. The appointment
-- grant stays behind current_appointment_lead_ids() -- never an inline
-- events subquery, which is exactly the recursion 0159 fixed
-- ("infinite recursion detected in policy for relation events");
-- partner_rep_id is a column on leads itself, so it carries no such
-- risk. Everything else restated verbatim.
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
    )
  );

-- ── 2. The sale: Salespeople grid tallies ────────────────────────────
--
-- Same buckets as 0156, now credited to both partners. Each rep's row
-- counts the lead and the Won notch; a partnership lead's value enters
-- each row at half, so summing the grid never overstates sales. The TS
-- fallback (src/lib/report-leads.ts repLeadStats) applies the same
-- arithmetic and is pinned by its tests. A partner equal to the owner
-- is one rep and one sale -- guarded here as it is there.

create or replace function public.rep_lead_stats(p_company uuid)
returns table (
  assigned_to uuid,
  assigned_count bigint,
  open_count bigint,
  won_count bigint,
  won_value numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    t.rep_id as assigned_to,
    count(*) as assigned_count,
    count(*) filter (where t.stage not in ('Won', 'Lost', 'DNC')) as open_count,
    count(*) filter (where t.stage = 'Won') as won_count,
    coalesce(sum(t.value) filter (where t.stage = 'Won'), 0) as won_value
  from (
    select
      l.assigned_to as rep_id,
      l.stage,
      case
        when l.partner_rep_id is not null
         and l.partner_rep_id is distinct from l.assigned_to
        then coalesce(l.value, 0) / 2.0
        else coalesce(l.value, 0)
      end as value
    from leads l
    where l.company_id = p_company
      and l.assigned_to is not null
    union all
    select
      l.partner_rep_id,
      l.stage,
      coalesce(l.value, 0) / 2.0
    from leads l
    where l.company_id = p_company
      and l.partner_rep_id is not null
      and l.partner_rep_id is distinct from l.assigned_to
  ) t
  group by t.rep_id
$$;

-- ── 3. The money: seeding at signature ───────────────────────────────
--
-- Same trigger as 0153, one addition: the partner takes rep seat two
-- at an even split. Guards, the closer's conversion and the
-- never-overwrite rule are unchanged.

create or replace function public.seed_sales_team_on_signature()
returns trigger as $$
declare
  lead_row record;
  closer_share_bp int;
  closer_pool_bp int;
begin
  -- Only the moment of signing, and only a contract. A change order or
  -- a completion certificate is an attachment to a contract, not a sale
  -- of its own -- the panel is not shown on them and they must not
  -- carry a second commission.
  if new.status is distinct from 'Signed' then return new; end if;
  if old.status = 'Signed' then return new; end if;
  if coalesce(new.kind, 'contract') <> 'contract' then return new; end if;

  -- Never overwrite a team somebody has already set. Re-signing, or a
  -- correction made by the office before the ink was recorded, must not
  -- throw away a deliberate decision about who is paid.
  if new.sales_rep_1 is not null or new.sales_rep_2 is not null
     or new.closer_id is not null then
    return new;
  end if;

  select l.assigned_to, l.partner_rep_id, l.closer_id, l.closer_bp, cp.default_closer_bp
    into lead_row
    from public.leads l
    left join public.company_profile cp on cp.company_id = l.company_id
   where l.id = new.lead_id;

  if not found then return new; end if;

  -- The rep who owns the contact is always the first seat. A partner
  -- on the lead takes seat two at an even split of the rep share --
  -- the partnership as it was worked, adjustable on the panel after.
  new.sales_rep_1 := lead_row.assigned_to;
  if lead_row.partner_rep_id is not null
     and lead_row.partner_rep_id is distinct from lead_row.assigned_to then
    new.sales_rep_2 := lead_row.partner_rep_id;
    new.sales_rep_1_bp := 5000;
    new.sales_rep_2_bp := 5000;
  else
    new.sales_rep_1_bp := 10000;
    new.sales_rep_2 := null;
    new.sales_rep_2_bp := 0;
  end if;

  if lead_row.closer_id is null then return new; end if;

  -- A typed figure on the lead beats the company default; the default
  -- is used only where nobody made a decision about this job.
  closer_share_bp := coalesce(lead_row.closer_bp, lead_row.default_closer_bp, 500);

  if coalesce(new.commission_rate_bp, 0) <= 0 then
    -- No pool to divide. The closer is still recorded, so the panel
    -- shows who was on the job and the office can set the rate.
    new.closer_id := lead_row.closer_id;
    new.closer_pool_bp := 0;
    return new;
  end if;

  closer_pool_bp := round(closer_share_bp::numeric / new.commission_rate_bp * 10000);
  closer_pool_bp := least(greatest(closer_pool_bp, 0), 10000);

  new.closer_id := lead_row.closer_id;
  new.closer_pool_bp := closer_pool_bp;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

comment on function public.seed_sales_team_on_signature() is
  'Fills a contract''s sales team from its lead at the moment of signature: the assigned rep in seat one, the lead''s partner rep in seat two at an even split (0163), the lead''s closer in the closer seat (0153) with their share of net profit converted into a share of the commission pool. Never overwrites a team that is already set.';

-- ── Proof rather than a success message ─────────────────────────────

-- The column landed and nothing carries a partner yet.
select
  (select count(*) from information_schema.columns
    where table_name = 'leads' and column_name = 'partner_rep_id') as partner_col,
  count(*) filter (where partner_rep_id is not null) as with_partner
from public.leads;

-- All three visibility rules know the partner seat, together.
select proname, prosrc like '%partner_rep_id%' as knows_partner
from pg_proc
where proname in ('lead_visible_to_current_user', 'current_visible_lead_ids');
select polname, pg_get_expr(polqual, polrelid) like '%partner_rep_id%' as knows_partner
from pg_policy
where polname = 'leads_select';

-- The grid's arithmetic still adds up: with no partners set yet, the
-- new tallies must equal the old ones row for row -- so this returns
-- zero rows.
select 'tallies changed with no partners set' as problem
from public.rep_lead_stats((select company_id from public.company_profile limit 1)) n
join (
  select l.assigned_to, count(*) filter (where l.stage = 'Won') as won_count
  from public.leads l
  where l.company_id = (select company_id from public.company_profile limit 1)
    and l.assigned_to is not null
  group by l.assigned_to
) o on o.assigned_to = n.assigned_to
where o.won_count <> n.won_count;

-- The seeding trigger seeds the partner seat.
select prosrc like '%lead_row.partner_rep_id%' as seeds_partner
from pg_proc
where proname = 'seed_sales_team_on_signature';
