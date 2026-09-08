-- The closer's share, wired into the money that already exists.
--
-- 0086 gave a signed contract two reps with a basis-point share each,
-- paid out of net profit. 0134 put a closer on the lead, with a share
-- and a company default. Nothing joined the two: the Sales Team panel
-- still opened blank on every signed contract and somebody typed the
-- names and the percentages in by hand, from memory, months after the
-- appointment.
--
-- This seeds that panel at the moment of signature, from the people who
-- were actually on the lead.
--
-- ── Why a trigger ───────────────────────────────────────────────────
--
-- A contract can be signed two ways: the customer signs in the portal,
-- and the office records a signature that happened on paper. Those are
-- different code paths, and a third will arrive. The same reasoning as
-- the default lead cost in 0089 -- patching the call sites would still
-- have missed whichever one is added next, and a contract that quietly
-- missed its seeding is a rep discovering months later that they were
-- never on the job.
--
-- ── The arithmetic ──────────────────────────────────────────────────
--
-- Two different bases meet here, and getting them the wrong way round
-- would silently pay the closer ten times too much.
--
--   commission_rate_bp  the rep pool, as a share of NET PROFIT
--                       (5000 = the reps get 50% of profit between them)
--   sales_rep_N_bp      each rep's share OF THAT POOL
--                       (the two always total 10000)
--   closer_bp           the closer's share of NET PROFIT (500 = 5%)
--
-- The closer's 5% comes OUT OF the rep's half, not on top of it. So it
-- has to be converted from a share of profit into a share of the pool:
--
--     closer_pool_bp = closer_bp / commission_rate_bp * 10000
--
-- With the defaults: 500 / 5000 * 10000 = 1000, so the closer takes 10%
-- of the pool and the rep 90%. Against a 50% pool that is 5% and 45% of
-- net profit -- the rep's 50 becomes 45, and the closer has the 5. Which
-- is the rule as it was described.
--
-- Two guards, because both of these are reachable by ordinary use:
--
--   * commission_rate_bp of 0 (no rate set on this contract) would
--     divide by zero. No pool means there is nothing to split, so the
--     seeding is skipped entirely.
--   * a closer share at or above the whole pool would leave the rep on
--     zero or negative. Clamped to the pool, which pays the closer
--     everything and the rep nothing -- wrong, but visibly wrong on the
--     panel, where a negative share would just look like a bug.

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
  if new.sales_rep_1 is not null or new.sales_rep_2 is not null then
    return new;
  end if;

  select l.assigned_to, l.closer_id, l.closer_bp, cp.default_closer_bp
    into lead_row
    from public.leads l
    left join public.company_profile cp on cp.company_id = l.company_id
   where l.id = new.lead_id;

  if not found then return new; end if;

  -- The rep who owns the contact is always the first seat, closer or
  -- not. This is the field every report and the customer-facing name
  -- already resolve from.
  new.sales_rep_1 := lead_row.assigned_to;

  if lead_row.closer_id is null then
    -- No closer: one rep, the whole pool. Same as the panel has always
    -- defaulted to when a second rep is left empty.
    new.sales_rep_1_bp := 10000;
    new.sales_rep_2 := null;
    new.sales_rep_2_bp := 0;
    return new;
  end if;

  -- A typed figure on the lead beats the company default; the default
  -- is used only where nobody made a decision about this job.
  closer_share_bp := coalesce(lead_row.closer_bp, lead_row.default_closer_bp, 500);

  if coalesce(new.commission_rate_bp, 0) <= 0 then
    -- No pool to divide. The closer is still recorded, so the panel
    -- shows who was on the job and the office can set the rate.
    new.sales_rep_2 := lead_row.closer_id;
    new.sales_rep_1_bp := 10000;
    new.sales_rep_2_bp := 0;
    return new;
  end if;

  closer_pool_bp := round(closer_share_bp::numeric / new.commission_rate_bp * 10000);
  closer_pool_bp := least(greatest(closer_pool_bp, 0), 10000);

  new.sales_rep_2 := lead_row.closer_id;
  new.sales_rep_2_bp := closer_pool_bp;
  -- The other share follows, so the two always make a whole -- the same
  -- rule the panel enforces when the figure is typed by hand.
  new.sales_rep_1_bp := 10000 - closer_pool_bp;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists estimates_seed_sales_team on public.estimates;
create trigger estimates_seed_sales_team
  before update on public.estimates
  for each row execute function public.seed_sales_team_on_signature();

comment on function public.seed_sales_team_on_signature() is
  'Fills a contract''s sales team from its lead at the moment of signature: the assigned rep in seat one, the lead''s closer in seat two, with the closer''s share of net profit converted into a share of the commission pool. Never overwrites a team that is already set.';

-- ── Proof rather than a success message ─────────────────────────────

-- The trigger exists and is attached to the right table and timing.
select tgname, tgtype, tgenabled
from pg_trigger
where tgname = 'estimates_seed_sales_team';

-- Nothing already signed is touched -- this fires on update only, and
-- only on the transition into Signed. These are the contracts that will
-- keep whatever team they have today, and the count should equal the
-- number of signed contracts already in the database.
select count(*) as already_signed_untouched
from public.estimates
where status = 'Signed'
  and coalesce(kind, 'contract') = 'contract';

-- The conversion, checked against the numbers it was specified with,
-- without writing anything. A 5% closer against a 50% pool must come
-- out as 1000/9000 -- that is the closer on 5% of net profit and the
-- rep on 45%, their 50 less the 5 they gave away.
select
  round(500::numeric / 5000 * 10000) as closer_pool_bp,
  10000 - round(500::numeric / 5000 * 10000) as rep_pool_bp,
  round(500::numeric / 5000 * 10000) / 10000 * 5000 / 100 as closer_pct_of_profit,
  (10000 - round(500::numeric / 5000 * 10000)) / 10000 * 5000 / 100 as rep_pct_of_profit;
