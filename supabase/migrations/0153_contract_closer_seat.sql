-- The closer gets their own seat on the contract.
--
-- 0135 seeded the closer into rep seat two (sales_rep_2) at signature.
-- That worked while a job only ever carried one rep and one closer --
-- but an appointment can carry two reps (events.second_assigned_to,
-- 0039), and with the closer occupying seat two there is nowhere to
-- put the second rep: the panel cannot pay three people from two
-- seats, and whoever loses the seat loses their commission line.
--
-- So the closer moves to their own columns, and the two rep seats go
-- back to being rep seats:
--
--   closer_id       who closed, stamped at signature from the lead
--   closer_pool_bp  their share OF THE POOL (the same converted figure
--                   0135 used to write into sales_rep_2_bp)
--
-- The reps' split (sales_rep_1_bp + sales_rep_2_bp = 10000) now divides
-- what the closer leaves behind. The arithmetic lives in
-- computeRepCommission (closerPoolBp) and is pinned by
-- src/lib/data/commission-gate.test.ts.
--
-- Contracts signed before this keep the closer in seat two with the
-- converted share already stamped -- their closer_pool_bp stays null,
-- which computes as zero, so not a cent of anything already earned is
-- restated. Only contracts signed after this seed the new seat.

alter table public.estimates
  add column if not exists closer_id uuid references public.profiles(id);
alter table public.estimates
  add column if not exists closer_pool_bp int;

comment on column public.estimates.closer_id is
  'The closer on this contract, stamped from leads.closer_id at signature (0153). Pre-0153 contracts carry their closer in sales_rep_2 instead, and this stays null there.';
comment on column public.estimates.closer_pool_bp is
  'The closer''s share of the commission pool, in basis points. Taken off the top; the rep seats split the remainder. Null computes as zero.';

-- The commission report resolves the closer's name per contract; the
-- common case (no closer) stays out of the index.
create index if not exists estimates_closer_id_idx
  on public.estimates (closer_id)
  where closer_id is not null;

-- ── Seeding, reworked ────────────────────────────────────────────────
--
-- Same trigger, same guards and the same conversion as 0135 (see that
-- migration for why closer_bp -- a share of net profit -- must be
-- divided by the commission rate to become a share of the pool). What
-- changes is only where the closer lands: their own seat, leaving
-- sales_rep_1/2 free for the rep -- and later a second rep -- whose
-- split the office sets on the panel.
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

  select l.assigned_to, l.closer_id, l.closer_bp, cp.default_closer_bp
    into lead_row
    from public.leads l
    left join public.company_profile cp on cp.company_id = l.company_id
   where l.id = new.lead_id;

  if not found then return new; end if;

  -- The rep who owns the contact is always the first seat, closer or
  -- not. This is the field every report and the customer-facing name
  -- already resolve from. The whole rep split until the office seats a
  -- second rep by hand -- the split is theirs to decide, not seeded.
  new.sales_rep_1 := lead_row.assigned_to;
  new.sales_rep_1_bp := 10000;
  new.sales_rep_2 := null;
  new.sales_rep_2_bp := 0;

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
  'Fills a contract''s sales team from its lead at the moment of signature: the assigned rep in seat one, the lead''s closer in the closer seat (0153), with the closer''s share of net profit converted into a share of the commission pool. Never overwrites a team that is already set.';

-- ── Proof rather than a success message ─────────────────────────────

-- Both columns landed.
select count(*) as closer_seat_cols
from information_schema.columns
where table_name = 'estimates'
  and column_name in ('closer_id', 'closer_pool_bp');

-- The trigger is still attached, once, and its body seeds the new seat.
select tgname, tgenabled
from pg_trigger
where tgrelid = 'public.estimates'::regclass
  and tgname = 'estimates_seed_sales_team';
select prosrc like '%new.closer_id := lead_row.closer_id%' as seeds_closer_seat
from pg_proc
where proname = 'seed_sales_team_on_signature';

-- Nothing already signed was touched: every existing contract keeps a
-- null closer seat, and their closers stay where 0135 put them (seat
-- two). Both counts must be zero.
select
  count(*) filter (where closer_id is not null) as with_new_seat,
  count(*) filter (where closer_pool_bp is not null) as with_new_share
from public.estimates;
