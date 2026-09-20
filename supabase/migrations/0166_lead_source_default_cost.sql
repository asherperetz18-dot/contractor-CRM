-- What a lead from each source costs, so a referral stops being priced
-- like a bought Facebook lead.
--
-- 0089 gave the company one default lead cost ($375) that lands on every
-- new lead arriving without a figure. This adds an optional figure to
-- each lead source and has the same trigger prefer it. Edited on
-- Settings › Lead Sources, next to each source, with the company default
-- on the same page.
--
-- Safe to run more than once.

-- 0089's column, in case this is pasted on a database that never got it.
alter table public.company_profile
  add column if not exists default_lead_cost numeric;

alter table public.lead_sources
  add column if not exists default_lead_cost numeric;

comment on column public.lead_sources.default_lead_cost is
  'Applied to a new lead from this source when no cost is entered. Null = no figure of its own, company_profile.default_lead_cost applies. 0 = leads from this source are free. Dollars, like leads.lead_cost.';

-- ── Applied on insert, in the database ──────────────────────────────
--
-- The 0089 trigger with one more lookup: the source's own figure first,
-- then the company default. Leads arrive by five paths (pipeline form,
-- CSV import, Facebook Lead Ads, the leads webhook, inbound email) and
-- this is the one place they all pass through.
--
-- Matched by name because leads.source stores the source's name, not
-- its id -- renaming a source already repoints its leads, so the two
-- never drift. Case and surrounding spaces are ignored so a webhook
-- sending "facebook" still finds "Facebook". If two rows collide on
-- name, the one carrying a figure wins.
--
-- Only fires when nothing was supplied. A typed 0 is a real answer --
-- "this one was free" -- and is left alone. Existing leads are not
-- touched: what they cost is already recorded.
create or replace function public.apply_default_lead_cost()
returns trigger as $$
declare
  source_cost numeric;
begin
  if new.lead_cost is null then
    if new.source is not null and btrim(new.source) <> '' then
      select s.default_lead_cost
        into source_cost
        from public.lead_sources s
       where s.company_id = new.company_id
         and lower(btrim(s.name)) = lower(btrim(new.source))
       order by (s.default_lead_cost is null), s.sort_order
       limit 1;
    end if;

    if source_cost is not null then
      new.lead_cost := source_cost;
    else
      select default_lead_cost
        into new.lead_cost
        from public.company_profile
       where company_id = new.company_id;
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists leads_default_cost on public.leads;
create trigger leads_default_cost
  before insert on public.leads
  for each row execute function public.apply_default_lead_cost();
