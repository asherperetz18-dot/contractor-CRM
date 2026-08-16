-- A company-level default lead cost, so a new lead arrives priced
-- instead of relying on somebody typing it. lead_cost is filled in on 5
-- of 1517 leads today, which is why cost per sale cannot be reported.
--
-- Stored per company rather than hard-coded: what a lead costs is a fact
-- about this business, and it changes.
alter table public.company_profile
  add column if not exists default_lead_cost numeric;

update public.company_profile
  set default_lead_cost = 375
  where default_lead_cost is null;

comment on column public.company_profile.default_lead_cost is
  'Applied to a new lead when no cost is entered. Existing leads are not touched by this column -- see the backfill in this migration.';

-- ── Applied on insert, in the database ──────────────────────────────
--
-- A trigger rather than the same three lines in every place a lead is
-- created. Leads arrive from the pipeline form, a CSV import and the
-- Facebook Lead Ads webhook, and the webhook ones are precisely the
-- bought leads that need a cost -- patching the call sites would still
-- have missed whichever path is added next.
--
-- A plain column default cannot do this: the figure belongs to the
-- company, and there are five of them in this database.
--
-- Only fires when nothing was supplied. A typed 0 is a real answer --
-- "this one was free" -- and is left alone.
create or replace function public.apply_default_lead_cost()
returns trigger as $$
begin
  if new.lead_cost is null then
    select default_lead_cost into new.lead_cost
      from public.company_profile
     where company_id = new.company_id;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists leads_default_cost on public.leads;
create trigger leads_default_cost
  before insert on public.leads
  for each row execute function public.apply_default_lead_cost();

-- ── Backfill of existing leads ──────────────────────────────────────
--
-- Deliberately NOT every lead. Two carve-outs, both of which would
-- otherwise put money in the Lead Refunds page that was never spent:
--
--   1. Leads that already carry a cost. Five do, ranging $1 to $700,
--      and they are the only real figures in the table. Overwriting
--      them with an average would destroy the only true data there is.
--
--   2. Sources that cost nothing per lead. A referral, a website
--      enquiry and a call from a job-site sign are not bought, and
--      claiming $375 each would invent $24,375 of spend across 63
--      leads.
--
-- Everything else -- Facebook, Google, the lead vendors and the
-- historical CSV import -- is treated as bought at the default.
update public.leads
   set lead_cost = 375
 where lead_cost is null
   and coalesce(source, '') not in ('Referral', 'Website', 'Job Site Sign');
