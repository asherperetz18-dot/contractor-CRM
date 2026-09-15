-- portal_payments grew four columns when hand-recorded payments shipped
-- (recordManualPayment in src/lib/actions/manual-payments.ts writes all
-- of them), but that SQL only ever ran in the Supabase editor and never
-- landed as a migration. On the live database every statement here is a
-- no-op; it exists so a database rebuilt from migrations alone can still
-- record a cash payment -- and so the Payments page, which now selects
-- reference and note, has the columns it reads.
begin;

alter table portal_payments
  -- Which door the money came in: Stripe checkout, or typed in by hand.
  add column if not exists source text not null default 'stripe'
    check (source in ('stripe', 'manual')),
  -- Who typed it. Cash with no trail is how money goes missing.
  add column if not exists recorded_by uuid references profiles (id) on delete set null,
  -- Cheque number, transfer reference, whatever proves it later.
  add column if not exists reference text,
  add column if not exists note text;

commit;
