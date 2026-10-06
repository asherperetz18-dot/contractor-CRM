-- 0213: removing a credit given by hand (DECISIONS #160).
--
-- A credit on a bill (0209, DECISIONS #154) could only be undone in the
-- database. Now Bookkeeping, Office or Admin can remove one given by
-- hand -- a wrong amount, the wrong bill -- and the bill owes it again.
-- The credit isn't deleted: it stays on record with who removed it,
-- when and why, and counts for nothing from then on.
--
--   * bill_credits.removed_at / removed_by / remove_reason.
--   * remove_bill_credit: checks and writes the removal together, the
--     bill's credited total coming down by the credit's amount. A credit
--     that came with a refund (0210) isn't removed on its own: removing
--     the refund takes its credit with it. The server only.
--
-- Columns and a function are added, nothing is removed: the running code
-- reads credits whole and works with or without them. Run in the
-- Supabase SQL editor. Safe to run twice.

begin;

alter table public.bill_credits
  add column if not exists removed_at timestamptz,
  add column if not exists removed_by uuid references public.profiles (id) on delete set null,
  add column if not exists remove_reason text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bill_credits_remove_reason_check') then
    alter table public.bill_credits
      add constraint bill_credits_remove_reason_check
      check (removed_at is null or coalesce(trim(remove_reason), '') <> '');
  end if;
end
$$;

comment on column public.bill_credits.removed_at is
  'Removed by hand (DECISIONS #160): kept on record, counts for nothing.';

-- Removes one credit given by hand. The bill is locked first, then the
-- credit -- the order giving a credit and removing a refund take them
-- in -- and the bill's credited total comes down with it.
create or replace function public.remove_bill_credit(
  p_company uuid,
  p_credit uuid,
  p_reason text,
  p_by uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phase uuid;
  v_credit record;
begin
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Say why the credit is removed.' using errcode = 'check_violation';
  end if;

  select c.estimate_payment_id into v_phase
    from public.bill_credits c
   where c.id = p_credit and c.company_id = p_company;
  if not found then
    raise exception 'That credit no longer exists.' using errcode = 'no_data_found';
  end if;

  perform 1 from public.estimate_payments ph
   where ph.id = v_phase and ph.company_id = p_company
   for update;

  select c.id, c.estimate_payment_id, c.amount_cents, c.refund_payment_id, c.removed_at
    into v_credit
    from public.bill_credits c
   where c.id = p_credit and c.company_id = p_company
   for update;
  if not found then
    raise exception 'That credit no longer exists.' using errcode = 'no_data_found';
  end if;
  if v_credit.removed_at is not null then
    raise exception 'That credit has already been removed.' using errcode = 'check_violation';
  end if;
  if v_credit.refund_payment_id is not null then
    raise exception 'This credit came with a refund. Remove the refund on the Payments page, and its credit goes with it.'
      using errcode = 'check_violation';
  end if;

  update public.estimate_payments
     set credit_cents = greatest(0, credit_cents - v_credit.amount_cents),
         updated_at = now()
   where id = v_credit.estimate_payment_id and company_id = p_company;

  update public.bill_credits
     set removed_at = now(),
         removed_by = p_by,
         remove_reason = trim(p_reason)
   where id = p_credit;
end
$$;

revoke all on function public.remove_bill_credit(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.remove_bill_credit(uuid, uuid, text, uuid) to service_role;

commit;

-- Check: should read true.
select
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'bill_credits' and column_name = 'removed_at')
  and exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'remove_bill_credit')
  as bill_credit_removal_ready;
