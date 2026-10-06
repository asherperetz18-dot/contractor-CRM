-- 0210: refunds (DECISIONS #155).
--
-- Step 6 of full invoicing, part two. A refund is money going back to
-- the customer: a payment row of its own, negative, pointing at the
-- payment it returns. Every sum of money in (Paid, Collected, P&L,
-- commissions, the dashboard) nets it with no change.
--
--   * portal_payments.refund_of: the payment a refund returns. A refund
--     is always negative and always points at one; a payment is always
--     positive and never does (the amount check below, replacing the old
--     "more than zero").
--   * portal_payments.stripe_refund_id: the refund at Stripe, so one
--     made in the Stripe dashboard is recorded once, however often Stripe
--     tells us.
--   * portal_payments.refund_still_owed: does the customer still owe
--     what was refunded? False: no -- a credit for it (0209) goes with
--     the refund, so the bill doesn't come back. True: yes (a bounced
--     check) -- the bill is owed again. Null: not decided yet (a refund
--     made in Stripe, decided in the CRM after).
--   * record_refund / decide_refund / remove_refund: the server's only
--     ways to write them, each checked and written in one step.
--   * give_bill_credit (0209) again, with one change: a refund still
--     going through at Stripe isn't money on its way in.
--
-- Run AFTER 0209, in the Supabase SQL editor. Columns and functions are
-- added; the old amount check is replaced by one that still refuses
-- zero and still refuses a negative payment. Safe to run twice.

begin;

alter table public.portal_payments
  add column if not exists refund_of uuid references public.portal_payments (id) on delete restrict;
alter table public.portal_payments
  add column if not exists stripe_refund_id text;
alter table public.portal_payments
  add column if not exists refund_still_owed boolean;

create unique index if not exists portal_payments_stripe_refund_id_key
  on public.portal_payments (stripe_refund_id) where stripe_refund_id is not null;
create index if not exists portal_payments_refund_of_idx
  on public.portal_payments (refund_of) where refund_of is not null;

comment on column public.portal_payments.refund_of is
  'The payment this refund returns (DECISIONS #155). Set on refunds only; a refund is negative.';
comment on column public.portal_payments.stripe_refund_id is
  'The refund at Stripe, for a refund made there.';
comment on column public.portal_payments.refund_still_owed is
  'Does the customer still owe what was refunded? false: no (credited); true: yes; null: not decided yet.';

-- Money in is positive and returns nothing; a refund is negative and
-- returns one payment.
alter table public.portal_payments drop constraint if exists portal_payments_amount_cents_check;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'portal_payments_amount_sign_check') then
    alter table public.portal_payments
      add constraint portal_payments_amount_sign_check
      check (amount_cents <> 0 and ((amount_cents > 0) = (refund_of is null)));
  end if;
end
$$;

-- 0209's credit, with one change: money on its way in is positive.
create or replace function public.give_bill_credit(
  p_company uuid,
  p_phase uuid,
  p_amount bigint,
  p_reason text,
  p_by uuid,
  p_refund uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phase record;
  v_status text;
  v_paid bigint;
  v_owed bigint;
  v_id uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount greater than zero.' using errcode = 'check_violation';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Say why the credit is given.' using errcode = 'check_violation';
  end if;

  select ph.id, ph.estimate_id, ph.amount_cents, ph.credit_cents, ph.requested_at, ph.cancelled_at
    into v_phase
    from public.estimate_payments ph
   where ph.id = p_phase and ph.company_id = p_company
   for update;
  if not found then
    raise exception 'That bill no longer exists.' using errcode = 'no_data_found';
  end if;

  select e.status into v_status
    from public.estimates e
   where e.id = v_phase.estimate_id and e.company_id = p_company;
  if v_status is distinct from 'Signed' then
    raise exception 'Only a bill on a signed contract or an issued invoice can be credited.' using errcode = 'check_violation';
  end if;
  if v_phase.requested_at is null or v_phase.cancelled_at is not null then
    raise exception 'Only a bill that has been billed can be credited.' using errcode = 'check_violation';
  end if;

  select coalesce(sum(pp.amount_cents) filter (
           where pp.status = 'succeeded'
              or (pp.status = 'pending' and pp.amount_cents > 0
                  and not (pp.stripe_session_id is not null and pp.stripe_payment_intent_id is null))
         ), 0)
    into v_paid
    from public.portal_payments pp
   where pp.estimate_payment_id = p_phase;

  v_owed := greatest(0, v_phase.amount_cents - v_phase.credit_cents - v_paid);
  if p_amount > v_owed then
    raise exception 'That is more than is still owed on this bill.' using errcode = 'check_violation';
  end if;

  insert into public.bill_credits (company_id, estimate_id, estimate_payment_id, amount_cents, reason, refund_payment_id, created_by)
  values (p_company, v_phase.estimate_id, p_phase, p_amount, trim(p_reason), p_refund, p_by)
  returning id into v_id;

  update public.estimate_payments
     set credit_cents = credit_cents + p_amount,
         updated_at = now()
   where id = p_phase;

  return v_id;
end
$$;

-- The credit that goes with a refund the customer no longer owes: what
-- was refunded, never more than is now owed on the bill (a refund of an
-- overpayment leaves nothing to credit). Only on a bill that can be
-- credited -- a cancelled contract owes nothing anyway.
create or replace function public.credit_after_refund(p_company uuid, p_refund uuid, p_by uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref public.portal_payments%rowtype;
  v_phase record;
  v_status text;
  v_paid bigint;
  v_owed bigint;
  v_credit bigint;
begin
  select * into v_ref from public.portal_payments where id = p_refund and company_id = p_company;
  if not found or v_ref.estimate_payment_id is null or v_ref.status <> 'succeeded' then
    return;
  end if;

  select ph.id, ph.estimate_id, ph.amount_cents, ph.credit_cents, ph.requested_at, ph.cancelled_at
    into v_phase
    from public.estimate_payments ph
   where ph.id = v_ref.estimate_payment_id and ph.company_id = p_company;
  if not found or v_phase.requested_at is null or v_phase.cancelled_at is not null then
    return;
  end if;
  select e.status into v_status from public.estimates e where e.id = v_phase.estimate_id and e.company_id = p_company;
  if v_status is distinct from 'Signed' then
    return;
  end if;

  select coalesce(sum(pp.amount_cents) filter (
           where pp.status = 'succeeded'
              or (pp.status = 'pending' and pp.amount_cents > 0
                  and not (pp.stripe_session_id is not null and pp.stripe_payment_intent_id is null))
         ), 0)
    into v_paid
    from public.portal_payments pp
   where pp.estimate_payment_id = v_phase.id;
  v_owed := greatest(0, v_phase.amount_cents - v_phase.credit_cents - v_paid);
  v_credit := least(-v_ref.amount_cents, v_owed);
  if v_credit > 0 then
    perform public.give_bill_credit(p_company, v_phase.id, v_credit, coalesce(v_ref.note, 'Refunded'), p_by, p_refund);
  end if;
end
$$;

-- Records one refund of one payment: never more than is left of it
-- (refunds still going through count against it), on a payment that has
-- arrived. With p_still_owed false, the credit goes with it.
create or replace function public.record_refund(
  p_company uuid,
  p_payment uuid,
  p_amount bigint,
  p_reason text,
  p_by uuid,
  p_still_owed boolean,
  p_method text default null,
  p_reference text default null,
  p_refunded_at timestamptz default null,
  p_stripe_refund_id text default null,
  p_status text default 'succeeded'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay public.portal_payments%rowtype;
  v_refunded bigint;
  v_id uuid;
  v_at timestamptz := coalesce(p_refunded_at, now());
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount greater than zero.' using errcode = 'check_violation';
  end if;
  if p_status not in ('pending', 'succeeded') then
    raise exception 'A refund is recorded as pending or succeeded.' using errcode = 'check_violation';
  end if;

  select * into v_pay
    from public.portal_payments
   where id = p_payment and company_id = p_company
   for update;
  if not found then
    raise exception 'Payment not found.' using errcode = 'no_data_found';
  end if;
  if v_pay.refund_of is not null or v_pay.amount_cents <= 0 then
    raise exception 'A refund can''t be refunded.' using errcode = 'check_violation';
  end if;
  if v_pay.status <> 'succeeded' then
    raise exception 'Only a payment that has arrived can be refunded.' using errcode = 'check_violation';
  end if;

  select coalesce(-sum(r.amount_cents), 0) into v_refunded
    from public.portal_payments r
   where r.refund_of = p_payment and r.status in ('pending', 'succeeded');
  if p_amount > v_pay.amount_cents - v_refunded then
    raise exception 'That is more than is left to refund on this payment.' using errcode = 'check_violation';
  end if;

  insert into public.portal_payments (
    company_id, estimate_id, estimate_payment_id, lead_id, kind, amount_cents, status, method, source,
    reference, note, recorded_by, paid_at, created_at, refund_of, stripe_refund_id, refund_still_owed
  ) values (
    p_company, v_pay.estimate_id, v_pay.estimate_payment_id, v_pay.lead_id, v_pay.kind, -p_amount, p_status,
    coalesce(nullif(trim(coalesce(p_method, '')), ''), v_pay.method),
    case when p_stripe_refund_id is null then 'manual' else 'stripe' end,
    nullif(trim(coalesce(p_reference, '')), ''),
    nullif(trim(coalesce(p_reason, '')), ''),
    p_by,
    case when p_status = 'succeeded' then v_at end,
    v_at,
    p_payment,
    p_stripe_refund_id,
    -- A deposit is no bill: there's nothing to decide.
    case when v_pay.estimate_payment_id is null then true else p_still_owed end
  )
  returning id into v_id;

  if p_still_owed is false and p_status = 'succeeded' then
    perform public.credit_after_refund(p_company, v_id, p_by);
  end if;
  return v_id;
end
$$;

-- Decides a refund made in Stripe: does the customer still owe it?
create or replace function public.decide_refund(p_company uuid, p_refund uuid, p_still_owed boolean, p_by uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref public.portal_payments%rowtype;
begin
  if p_still_owed is null then
    raise exception 'Say whether they still owe it.' using errcode = 'check_violation';
  end if;
  select * into v_ref
    from public.portal_payments
   where id = p_refund and company_id = p_company
   for update;
  if not found or v_ref.refund_of is null then
    raise exception 'Refund not found.' using errcode = 'no_data_found';
  end if;
  if v_ref.refund_still_owed is not null then
    raise exception 'This refund has already been decided.' using errcode = 'check_violation';
  end if;
  if v_ref.status <> 'succeeded' then
    raise exception 'This refund is still going through at Stripe. Decide once it has.' using errcode = 'check_violation';
  end if;
  update public.portal_payments set refund_still_owed = p_still_owed, updated_at = now() where id = p_refund;
  if not p_still_owed then
    perform public.credit_after_refund(p_company, p_refund, p_by);
  end if;
end
$$;

-- Takes out a refund recorded by mistake, with the credit that came
-- with it. Only one recorded by hand: a Stripe refund is Stripe's.
create or replace function public.remove_refund(p_company uuid, p_refund uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref public.portal_payments%rowtype;
  v_credit record;
begin
  select * into v_ref
    from public.portal_payments
   where id = p_refund and company_id = p_company
   for update;
  if not found or v_ref.refund_of is null then
    raise exception 'Refund not found.' using errcode = 'no_data_found';
  end if;
  if v_ref.source <> 'manual' then
    raise exception 'A refund made in Stripe can''t be removed here.' using errcode = 'check_violation';
  end if;
  for v_credit in
    select id, estimate_payment_id, amount_cents from public.bill_credits
     where refund_payment_id = p_refund and company_id = p_company
  loop
    update public.estimate_payments
       set credit_cents = greatest(0, credit_cents - v_credit.amount_cents),
           updated_at = now()
     where id = v_credit.estimate_payment_id;
    delete from public.bill_credits where id = v_credit.id;
  end loop;
  delete from public.portal_payments where id = p_refund;
end
$$;

revoke all on function public.credit_after_refund(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.credit_after_refund(uuid, uuid, uuid) to service_role;
revoke all on function public.record_refund(uuid, uuid, bigint, text, uuid, boolean, text, text, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.record_refund(uuid, uuid, bigint, text, uuid, boolean, text, text, timestamptz, text, text) to service_role;
revoke all on function public.decide_refund(uuid, uuid, boolean, uuid) from public, anon, authenticated;
grant execute on function public.decide_refund(uuid, uuid, boolean, uuid) to service_role;
revoke all on function public.remove_refund(uuid, uuid) from public, anon, authenticated;
grant execute on function public.remove_refund(uuid, uuid) to service_role;

commit;

-- Check: should read true.
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'portal_payments'
      and column_name in ('refund_of', 'stripe_refund_id', 'refund_still_owed')) = 3
  and exists (select 1 from pg_constraint where conname = 'portal_payments_amount_sign_check')
  and not exists (select 1 from pg_constraint where conname = 'portal_payments_amount_cents_check')
  and (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
        and proname in ('record_refund', 'decide_refund', 'remove_refund', 'credit_after_refund')) = 4
  as refunds_ready;
