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
--   * give_bill_credit (0209) again, with two changes: a refund still
--     going through at Stripe isn't money on its way in, and the credit
--     that goes with a refund can sit on a stage not billed yet.
--   * settle_refund: a Stripe refund going through, or failing (a failed
--     one takes back the credit that came with it).
--   * dashboard_rollup (0209) again, with the same one change: a refund
--     still going through isn't money on its way in.
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
  -- A credit given by hand is on a bill; the one that goes with a
  -- refund can be on a stage paid before it was billed.
  if v_phase.cancelled_at is not null or (v_phase.requested_at is null and p_refund is null) then
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
-- was refunded, never more than is now owed on the stage (a refund of an
-- overpayment leaves nothing to credit). Billed or not yet -- a stage
-- paid early and part refunded is billed later for the rest -- but never
-- on a cancelled bill or contract, which owes nothing anyway.
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
  if not found or v_phase.cancelled_at is not null then
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
  if p_refunded_at > now() + interval '1 day' then
    raise exception 'A refund can''t be dated in the future.' using errcode = 'check_violation';
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

  -- Stripe tells us about a refund more than once, sometimes at the same
  -- moment. The payment's lock above puts the second after the first:
  -- it finds the row and is done, rather than reading as too much.
  if p_stripe_refund_id is not null then
    select r.id into v_id
      from public.portal_payments r
     where r.stripe_refund_id = p_stripe_refund_id and r.company_id = p_company;
    if found then
      return v_id;
    end if;
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
  if v_ref.status = 'pending' then
    raise exception 'This refund is still going through at Stripe. Decide once it has.' using errcode = 'check_violation';
  end if;
  if v_ref.status <> 'succeeded' then
    raise exception 'This refund didn''t go through at Stripe, so there''s nothing to decide.' using errcode = 'check_violation';
  end if;
  update public.portal_payments set refund_still_owed = p_still_owed, updated_at = now() where id = p_refund;
  if not p_still_owed then
    perform public.credit_after_refund(p_company, p_refund, p_by);
  end if;
end
$$;

-- Takes back the credit that came with a refund.
create or replace function public.drop_refund_credits(p_company uuid, p_refund uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_credit record;
begin
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
end
$$;

-- A refund made in Stripe moving on: going through, gone through, or
-- failed. A failed one never moved money, so the credit that came with
-- it goes too -- the bill is back where it was.
create or replace function public.settle_refund(p_company uuid, p_refund uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref public.portal_payments%rowtype;
begin
  if p_status not in ('pending', 'succeeded', 'failed', 'cancelled') then
    raise exception 'Unknown refund status.' using errcode = 'check_violation';
  end if;
  select * into v_ref
    from public.portal_payments
   where id = p_refund and company_id = p_company
   for update;
  if not found or v_ref.refund_of is null then
    raise exception 'Refund not found.' using errcode = 'no_data_found';
  end if;
  if v_ref.status = p_status then
    return;
  end if;
  update public.portal_payments
     set status = p_status,
         paid_at = case when p_status = 'succeeded' then coalesce(paid_at, now()) end,
         updated_at = now()
   where id = p_refund;
  if p_status in ('failed', 'cancelled') then
    perform public.drop_refund_credits(p_company, p_refund);
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
  perform public.drop_refund_credits(p_company, p_refund);
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
revoke all on function public.drop_refund_credits(uuid, uuid) from public, anon, authenticated;
grant execute on function public.drop_refund_credits(uuid, uuid) to service_role;
revoke all on function public.settle_refund(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.settle_refund(uuid, uuid, text) to service_role;

-- The dashboard: the 0209 definition, with that same one change.
CREATE OR REPLACE FUNCTION public.dashboard_rollup(p_company uuid, p_from date, p_to date, p_prev_from date, p_prev_to date, p_months_from date, p_today date, p_d30 date, p_d60 date, p_d90 date, p_calls_from date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with
cohort as (
  select id, stage, value, has_appt,
         coalesce(nullif(source, ''), 'Unknown') as source
  from leads
  where company_id = p_company
    and (p_from is null or (created_at at time zone 'utc')::date >= p_from)
    and (p_to is null or (created_at at time zone 'utc')::date <= p_to)
),
cohort_est as (
  select e.lead_id,
         bool_or(e.status <> 'Draft') as saw,
         coalesce(sum(e.total_cents) filter (where e.status = 'Signed'), 0) as signed_cents
  from estimates e
  join cohort c on c.id = e.lead_id
  where e.company_id = p_company
    and coalesce(e.kind, 'contract') = 'contract'
  group by e.lead_id
),
sales as (
  select id as sale_id, assigned_to,
         sales_rep_1, sales_rep_1_bp, sales_rep_2, sales_rep_2_bp,
         (signed_at at time zone 'utc')::date as signed_day,
         to_char(signed_at at time zone 'utc', 'YYYY-MM') as signed_month,
         total_cents
  from estimates
  where company_id = p_company
    and status = 'Signed'
    and coalesce(kind, 'contract') = 'contract'
    and signed_at is not null
),
-- Who each sale counts for on the team panel: the Sales team seats with
-- a share, dollars split by share; seats without a share fall to seat
-- one; no seats falls to the stamped rep (src/lib/data/sale-credit.ts).
sale_seats as (
  select sale_id, sales_rep_1 as rep, coalesce(sales_rep_1_bp, 10000) as bp, 1 as ord
  from sales where sales_rep_1 is not null
  union all
  select sale_id, sales_rep_2, coalesce(sales_rep_2_bp, 0), 2
  from sales where sales_rep_2 is not null
),
sale_credits as (
  select s.sale_id, s.signed_day, x.rep,
         round(s.total_cents * x.bp / 10000.0)::bigint as cents
  from sales s
  join sale_seats x on x.sale_id = s.sale_id and x.bp > 0
  union all
  select s.sale_id, s.signed_day,
         (select x.rep from sale_seats x where x.sale_id = s.sale_id order by x.ord limit 1),
         s.total_cents
  from sales s
  where exists (select 1 from sale_seats x where x.sale_id = s.sale_id)
    and not exists (select 1 from sale_seats x where x.sale_id = s.sale_id and x.bp > 0)
  union all
  select s.sale_id, s.signed_day, s.assigned_to, s.total_cents
  from sales s
  where s.assigned_to is not null
    and not exists (select 1 from sale_seats x where x.sale_id = s.sale_id)
),
pays as (
  select amount_cents,
         (coalesce(paid_at, created_at) at time zone 'utc')::date as pay_day,
         to_char(coalesce(paid_at, created_at) at time zone 'utc', 'YYYY-MM') as pay_month
  from portal_payments
  where company_id = p_company and status = 'succeeded'
),
win_events as (
  select assigned_to
  from events
  where company_id = p_company
    and (p_from is null or date >= p_from)
    and (p_to is null or date <= p_to)
),
phases as (
  -- What each bill asks once its credits are off (0209, DECISIONS #154).
  select ph.id, ph.amount_cents - ph.credit_cents as amount_cents, ph.credit_cents, ph.due_date,
         coalesce(sum(pp.amount_cents) filter (where pp.status = 'succeeded'), 0) as settled,
         -- Money on its way in: a refund still going through isn't (0210).
         coalesce(sum(pp.amount_cents) filter (where pp.status = 'pending' and pp.amount_cents > 0), 0) as pending,
         coalesce(bool_or(pp.status = 'succeeded'), false) as any_succeeded
  from estimate_payments ph
  join estimates e on e.id = ph.estimate_id and e.status = 'Signed'
  left join portal_payments pp on pp.estimate_payment_id = ph.id
  where ph.company_id = p_company and ph.requested_at is not null
  group by ph.id, ph.amount_cents, ph.credit_cents, ph.due_date
),
phase_rows as (
  select greatest(0, amount_cents - settled) as owed,
         case
           when (any_succeeded or credit_cents > 0) and settled >= amount_cents then 'paid'
           when pending > 0 and settled + pending >= amount_cents then 'clearing'
           when due_date is not null and due_date < p_today then 'overdue'
           when settled > 0 then 'partial'
           else 'billed'
         end as state,
         case when due_date is not null then p_today - due_date else 0 end as late
  from phases
),
open_leads as (
  select stage::text as stage, value,
         (updated_at at time zone 'utc')::date as touch
  from leads
  where company_id = p_company
    and not public.is_closed_stage(stage_key)
)
select jsonb_build_object(
  'attention', jsonb_build_object(
    'overdueTasks', (
      select count(*) from lead_tasks
      where company_id = p_company and completed_at is null and due_date < p_today
    ),
    'apptsToday', (
      select count(*) from events where company_id = p_company and date = p_today
    ),
    'awaitingCount', (
      select count(*) from estimates
      where company_id = p_company and status in ('Sent', 'Viewed')
        and coalesce(kind, 'contract') = 'contract'
    ),
    'awaitingCents', (
      select coalesce(sum(total_cents), 0) from estimates
      where company_id = p_company and status in ('Sent', 'Viewed')
        and coalesce(kind, 'contract') = 'contract'
    ),
    'overdueOwedCents', (
      select coalesce(sum(owed), 0) from phase_rows where state = 'overdue' and owed > 0
    ),
    'overdueOwedCount', (
      select count(*) from phase_rows where state = 'overdue' and owed > 0
    )
  ),
  'window', jsonb_build_object(
    'leads', (select count(*) from cohort),
    'appts', (select count(*) from win_events),
    'signedCount', (
      select count(*) from sales
      where (p_from is null or signed_day >= p_from) and (p_to is null or signed_day <= p_to)
    ),
    'signedCents', (
      select coalesce(sum(total_cents), 0) from sales
      where (p_from is null or signed_day >= p_from) and (p_to is null or signed_day <= p_to)
    ),
    'collectedCents', (
      select coalesce(sum(amount_cents), 0) from pays
      where (p_from is null or pay_day >= p_from) and (p_to is null or pay_day <= p_to)
    )
  ),
  'prev', jsonb_build_object(
    'leads', (
      select count(*) from leads
      where company_id = p_company and p_prev_from is not null
        and (created_at at time zone 'utc')::date between p_prev_from and p_prev_to
    ),
    'appts', (
      select count(*) from events
      where company_id = p_company and p_prev_from is not null
        and date between p_prev_from and p_prev_to
    ),
    'signedCount', (
      select count(*) from sales
      where p_prev_from is not null and signed_day between p_prev_from and p_prev_to
    ),
    'signedCents', (
      select coalesce(sum(total_cents), 0) from sales
      where p_prev_from is not null and signed_day between p_prev_from and p_prev_to
    ),
    'collectedCents', (
      select coalesce(sum(amount_cents), 0) from pays
      where p_prev_from is not null and pay_day between p_prev_from and p_prev_to
    )
  ),
  'months', (
    select jsonb_agg(
      jsonb_build_object(
        'month', to_char(m.d, 'YYYY-MM'),
        'signedCents', coalesce(s.cents, 0),
        'collectedCents', coalesce(p.cents, 0)
      ) order by m.d
    )
    from generate_series(p_months_from, p_months_from + interval '11 months', interval '1 month') as m(d)
    left join (select signed_month, sum(total_cents) as cents from sales group by 1) s
      on s.signed_month = to_char(m.d, 'YYYY-MM')
    left join (select pay_month, sum(amount_cents) as cents from pays group by 1) p
      on p.pay_month = to_char(m.d, 'YYYY-MM')
  ),
  'funnel', jsonb_build_object(
    'leads', (select count(*) from cohort),
    'withAppt', (select count(*) from cohort where has_appt),
    'estimated', (
      select count(*) from cohort c join cohort_est ce on ce.lead_id = c.id where ce.saw
    ),
    'signed', (
      select count(*) from cohort c join cohort_est ce on ce.lead_id = c.id
      where ce.signed_cents > 0
    )
  ),
  'stages', (
    select coalesce(jsonb_agg(row order by stage), '[]'::jsonb)
    from (
      select stage,
        jsonb_build_object(
          'stage', stage,
          'buckets', jsonb_build_object(
            'd30', jsonb_build_object(
              'count', count(*) filter (where touch >= p_d30),
              'value', coalesce(sum(value) filter (where touch >= p_d30), 0)
            ),
            'd60', jsonb_build_object(
              'count', count(*) filter (where touch >= p_d60),
              'value', coalesce(sum(value) filter (where touch >= p_d60), 0)
            ),
            'd90', jsonb_build_object(
              'count', count(*) filter (where touch >= p_d90),
              'value', coalesce(sum(value) filter (where touch >= p_d90), 0)
            ),
            'all', jsonb_build_object(
              'count', count(*),
              'value', coalesce(sum(value), 0)
            )
          )
        ) as row
      from open_leads
      group by stage
    ) t
  ),
  'sources', (
    select coalesce(jsonb_agg(row order by cnt desc, source asc), '[]'::jsonb)
    from (
      select c.source, count(*) as cnt,
        jsonb_build_object(
          'source', c.source,
          'count', count(*),
          'signedCount', count(*) filter (where ce.signed_cents > 0),
          'signedCents', coalesce(sum(ce.signed_cents) filter (where ce.signed_cents > 0), 0)
        ) as row
      from cohort c
      left join cohort_est ce on ce.lead_id = c.id
      group by c.source
    ) t
  ),
  'aging', jsonb_build_object(
    'notYetDueCents', (
      select coalesce(sum(owed), 0) from phase_rows
      where owed > 0 and state in ('billed', 'partial', 'clearing')
    ),
    'late1_30Cents', (
      select coalesce(sum(owed), 0) from phase_rows
      where owed > 0 and state = 'overdue' and late <= 30
    ),
    'late31_60Cents', (
      select coalesce(sum(owed), 0) from phase_rows
      where owed > 0 and state = 'overdue' and late > 30 and late <= 60
    ),
    'late61PlusCents', (
      select coalesce(sum(owed), 0) from phase_rows
      where owed > 0 and state = 'overdue' and late > 60
    ),
    'overdueCount', (
      select count(*) from phase_rows where owed > 0 and state = 'overdue'
    )
  ),
  'team', (
    select coalesce(
      jsonb_agg(row order by cents desc, appts desc, rep asc), '[]'::jsonb
    )
    from (
      select coalesce(ts.rep, ta.rep) as rep,
             coalesce(ts.cents, 0) as cents,
             coalesce(ta.n, 0) as appts,
             jsonb_build_object(
               'rep', coalesce(ts.rep, ta.rep),
               'signedCount', coalesce(ts.n, 0),
               'signedCents', coalesce(ts.cents, 0),
               'appts', coalesce(ta.n, 0)
             ) as row
      from (
        select rep, count(*) as n, sum(cents) as cents
        from sale_credits
        where (p_from is null or signed_day >= p_from)
          and (p_to is null or signed_day <= p_to)
        group by rep
      ) ts
      full join (
        select assigned_to as rep, count(*) as n
        from win_events
        where assigned_to is not null
        group by assigned_to
      ) ta on ta.rep = ts.rep
    ) t
  ),
  'calls', jsonb_build_object(
    'dials', (
      select count(*) from call_logs
      where company_id = p_company
        and (p_from is null or (created_at at time zone 'utc')::date >= p_from)
        and (p_to is null or (created_at at time zone 'utc')::date <= p_to)
    ),
    'connected', (
      select count(*) from call_logs
      where company_id = p_company and duration_seconds > 0
        and (p_from is null or (created_at at time zone 'utc')::date >= p_from)
        and (p_to is null or (created_at at time zone 'utc')::date <= p_to)
    ),
    'talkSeconds', (
      select coalesce(sum(duration_seconds), 0) from call_logs
      where company_id = p_company
        and (p_from is null or (created_at at time zone 'utc')::date >= p_from)
        and (p_to is null or (created_at at time zone 'utc')::date <= p_to)
    ),
    'perDay', (
      select jsonb_agg(
        jsonb_build_object('day', to_char(d.d, 'YYYY-MM-DD'), 'dials', coalesce(c.n, 0))
        order by d.d
      )
      from generate_series(p_calls_from, p_today, interval '1 day') as d(d)
      left join (
        select (created_at at time zone 'utc')::date as day, count(*) as n
        from call_logs
        where company_id = p_company
          and (created_at at time zone 'utc')::date >= p_calls_from
        group by 1
      ) c on c.day = d.d::date
    )
  ),
  'production', jsonb_build_object(
    'notStarted', (
      select count(*) from jobs where company_id = p_company and status = 'Not Started'
    ),
    'inProgress', (
      select count(*) from jobs where company_id = p_company and status = 'In Progress'
    ),
    'onHold', (
      select count(*) from jobs where company_id = p_company and status = 'On Hold'
    ),
    'completedInWindow', (
      select count(*) from jobs
      where company_id = p_company and status = 'Complete'
        and (p_from is null
             or coalesce(end_date, (updated_at at time zone 'utc')::date) >= p_from)
        and (p_to is null
             or coalesce(end_date, (updated_at at time zone 'utc')::date) <= p_to)
    )
  )
)
$function$;

commit;

-- Check: should read true.
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'portal_payments'
      and column_name in ('refund_of', 'stripe_refund_id', 'refund_still_owed')) = 3
  and exists (select 1 from pg_constraint where conname = 'portal_payments_amount_sign_check')
  and not exists (select 1 from pg_constraint where conname = 'portal_payments_amount_cents_check')
  and (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
        and proname in ('record_refund', 'decide_refund', 'remove_refund', 'credit_after_refund',
                        'drop_refund_credits', 'settle_refund')) = 6
  and pg_get_functiondef('public.dashboard_rollup'::regproc) like '%pp.amount_cents > 0%'
  as refunds_ready;
