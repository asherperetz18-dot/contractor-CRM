-- Approval before a document goes to the customer.
--
-- The ask was "I check most estimates before they go out, and I want the
-- document to show that I checked it". The first shape suggested for
-- that was putting the checker's name in the rep slot -- which does not
-- record approval, it erases who wrote the thing, and now that a closer
-- can be paid from that same field it would move money too.
--
-- So: approval is its own fact. Who approved, and when. The rep who
-- wrote the estimate stays the rep who wrote it.
--
-- ── Off until it is switched on ─────────────────────────────────────
--
-- require_estimate_approval defaults to FALSE, and that is not timidity.
-- A gate like this turned on the moment it merges stops every estimate
-- in the company from going out, including the ones half-typed when it
-- landed. It is switched on deliberately, by an admin, once they can see
-- the approvals screen.
--
-- ── Why a trigger ───────────────────────────────────────────────────
--
-- Three separate paths take a document out of Draft: emailing or texting
-- it to the customer, marking it sent by hand, and recording a signature
-- that happened on paper. A gate enforced in one of them is not a gate.
-- Same reasoning as 0089 and 0135 -- and here it matters more, because
-- the whole point of this feature is that nothing slips past.

alter table public.estimates
  add column if not exists approved_at timestamptz;
alter table public.estimates
  add column if not exists approved_by uuid references public.profiles(id);

comment on column public.estimates.approved_at is
  'When this document was approved to go out. Cleared if the document is edited back to Draft -- different numbers need a fresh look.';
comment on column public.estimates.approved_by is
  'Who approved it. Kept alongside the rep who wrote it, never in place of them.';

alter table public.company_profile
  add column if not exists require_estimate_approval boolean not null default false;

comment on column public.company_profile.require_estimate_approval is
  'When true, a document cannot leave Draft until it is approved. Off by default: switching it on stops every unapproved estimate from going out, so it is an admin decision made deliberately.';

-- The approvals screen asks "what is waiting on me" on every load, which
-- is a scan of the whole table for the two or three rows that qualify.
create index if not exists estimates_pending_approval_idx
  on public.estimates (company_id, status)
  where approved_at is null;

create or replace function public.enforce_estimate_approval()
returns trigger as $$
declare
  needs_approval boolean;
begin
  -- ── Editing a sent document pulls it back to Draft ────────────────
  --
  -- guardEstimateEdit already does that, and already deletes the
  -- contractor's signature when it happens, on the grounds that
  -- different numbers need a fresh signature. An approval is the same
  -- kind of promise about the same numbers, so it goes the same way.
  -- Without this, approving once would approve every later version of
  -- the document, which is the exact hole this feature exists to close.
  if new.status = 'Draft' and old.status is distinct from 'Draft' then
    new.approved_at := null;
    new.approved_by := null;
    return new;
  end if;

  -- Only the moment of leaving Draft. Everything after that -- viewed,
  -- signed in the portal, voided -- is downstream of a send that was
  -- already allowed.
  if old.status is distinct from 'Draft' then return new; end if;
  if new.status not in ('Sent', 'Signed') then return new; end if;
  if new.approved_at is not null then return new; end if;

  select cp.require_estimate_approval into needs_approval
    from public.company_profile cp
   where cp.company_id = new.company_id;

  if coalesce(needs_approval, false) = false then return new; end if;

  -- Surfaced to whoever pressed Send, so the message has to say what to
  -- do rather than name a constraint.
  raise exception
    'This document needs to be approved before it can go out. Ask an admin to approve % on the Approvals screen.',
    coalesce(new.doc_number, 'it')
    using errcode = 'check_violation';
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists estimates_enforce_approval on public.estimates;
create trigger estimates_enforce_approval
  before update on public.estimates
  for each row execute function public.enforce_estimate_approval();

-- ── Proof rather than a success message ─────────────────────────────

-- Both triggers on this table, and the order they fire in. Postgres runs
-- BEFORE triggers alphabetically by name, so estimates_enforce_approval
-- runs before estimates_seed_sales_team (0135). That is the right way
-- round: a document refused a send never reaches the seeding, and the
-- seeding only ever fires on a transition into Signed that was allowed.
select tgname, tgenabled
from pg_trigger
where tgrelid = 'public.estimates'::regclass
  and not tgisinternal
order by tgname;

-- Every company is off. If any row reads true here, this merged with the
-- gate live and estimates stopped going out -- which is the one failure
-- this migration is written to avoid.
select company_id, require_estimate_approval
from public.company_profile;

-- Nothing is retrospectively unapproved into a corner: existing sent and
-- signed documents are past the gate, which only fires on leaving Draft.
select status, count(*) as documents, count(approved_at) as approved
from public.estimates
group by status
order by status;
