-- 0205: draft invoices, their own numbering, and payment terms
-- (DECISIONS #149).
--
-- Step 2 of full invoicing. An invoice could only be issued the moment
-- it was saved, numbered from the estimates' counter (so invoice numbers
-- skipped), with no terms on it. Now:
--
--   * invoices count on their own: INV-1001, INV-1002, ... Each company's
--     counter starts above the highest invoice number it already has, and
--     never hands out a number already on a document -- so an invoice the
--     old code numbered between this running and the deploy can't clash.
--   * an invoice carries its payment terms (days until due: 0 is due on
--     receipt), printed on it and used to date it when it is issued.
--   * a draft invoice can be issued later. The approval gate (0136) fires
--     when a document leaves Draft; it was written for estimates, and an
--     invoice was never held by it (they were inserted already issued),
--     so invoices stay outside it.
--
-- Columns are added, nothing is removed: the running code ignores them.
-- Run in the Supabase SQL editor BEFORE merging the pull request.

begin;

-- ── Invoice numbering ──────────────────────────────────────────────

alter table public.company_profile
  add column if not exists invoice_seq integer not null default 1000;

comment on column public.company_profile.invoice_seq is
  'The last invoice number handed out (INV-<n>). Starts above any invoice number the company already had, at 1000 at the least.';

update public.company_profile cp
   set invoice_seq = greatest(
     cp.invoice_seq,
     coalesce((
       select max(substring(e.doc_number from '^INV-(\d+)$')::integer)
         from public.estimates e
        where e.company_id = cp.company_id
          and e.doc_number ~ '^INV-\d+$'
     ), 0)
   );

-- The next free INV-<n> for a company the caller belongs to. Skips any
-- number already on one of the company's documents.
create or replace function public.next_invoice_number(check_company_id uuid)
returns text as $$
declare
  n integer;
begin
  if not public.is_member_of_company(check_company_id) then
    raise exception 'Not a member of this company.' using errcode = 'insufficient_privilege';
  end if;
  loop
    update public.company_profile
       set invoice_seq = invoice_seq + 1
     where company_id = check_company_id
    returning invoice_seq into n;
    if n is null then
      raise exception 'This company has no profile to number invoices from.';
    end if;
    exit when not exists (
      select 1 from public.estimates
       where company_id = check_company_id
         and doc_number = 'INV-' || n
    );
  end loop;
  return 'INV-' || n;
end;
$$ language plpgsql volatile security definer set search_path = public;

revoke all on function public.next_invoice_number(uuid) from public, anon;
grant execute on function public.next_invoice_number(uuid) to authenticated, service_role;

-- ── Payment terms ──────────────────────────────────────────────────

alter table public.estimates
  add column if not exists payment_terms_days integer
    check (payment_terms_days is null or payment_terms_days between 0 and 365);

comment on column public.estimates.payment_terms_days is
  'An invoice''s payment terms: days from issue until it is due (0 = due on receipt). Null on other documents.';

-- ── The approval gate leaves invoices alone ────────────────────────
-- 0136's function, with one line added: an invoice is not an estimate
-- waiting for approval.

create or replace function public.enforce_estimate_approval()
returns trigger as $$
declare
  needs_approval boolean;
begin
  if new.status = 'Draft' and old.status is distinct from 'Draft' then
    new.approved_at := null;
    new.approved_by := null;
    return new;
  end if;

  if old.status is distinct from 'Draft' then return new; end if;
  if new.status not in ('Sent', 'Signed') then return new; end if;
  -- Invoices were never held here (they used to be inserted already
  -- issued); a draft invoice being issued is the same act.
  if coalesce(new.kind, 'contract') = 'invoice' then return new; end if;
  if new.approved_at is not null then return new; end if;

  select cp.require_estimate_approval into needs_approval
    from public.company_profile cp
   where cp.company_id = new.company_id;

  if coalesce(needs_approval, false) = false then return new; end if;

  raise exception
    'This document needs to be approved before it can go out. Ask an admin to approve % on the Approvals screen.',
    coalesce(new.doc_number, 'it')
    using errcode = 'check_violation';
end;
$$ language plpgsql security definer set search_path = public;

commit;

-- Check: should read true.
select
  (select count(*) from information_schema.columns
    where table_schema = 'public'
      and ((table_name = 'company_profile' and column_name = 'invoice_seq')
        or (table_name = 'estimates' and column_name = 'payment_terms_days'))) = 2
  and exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'next_invoice_number')
  and pg_get_functiondef('public.enforce_estimate_approval'::regproc) like '%''invoice''%'
  as invoice_drafts_ready;
