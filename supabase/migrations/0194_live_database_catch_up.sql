-- Catch-up: what the live database was missing (DECISIONS #115).
--
-- A full comparison of production with these files on 2026-10-05 found
-- four files that were never run there:
--   0137_call_center_lead_writes.sql  Call Center can't edit a contact or
--                                     add a call note from the dialer
--   0138_ai_call_notes.sql            AI call notes have nowhere to save
--   0171_dispatch_rollup.sql          the dispatch dashboard's summary
--   0182_lead_file_deletions.sql      the record of deleted files
-- Run those four first, in that order, then this file. It stops with a
-- message naming any that are still missing.
--
-- Safe to run twice.

do $$
declare
  missing text[] := '{}';
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'leads' and policyname = 'leads_update'
      and qual like '%Call Center%'
  ) then
    missing := missing || '0137_call_center_lead_writes.sql'::text;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'call_logs' and column_name = 'transcript_sid'
  ) then
    missing := missing || '0138_ai_call_notes.sql'::text;
  end if;
  if to_regproc('public.dispatch_rollup') is null then
    missing := missing || '0171_dispatch_rollup.sql'::text;
  end if;
  if to_regclass('public.lead_file_deletions') is null then
    missing := missing || '0182_lead_file_deletions.sql'::text;
  end if;
  if cardinality(missing) > 0 then
    raise exception 'Run these first, in this order: %', array_to_string(missing, ', ');
  end if;
end
$$;

-- portal_payments.recorded_by: 0151 meant a manual payment to outlive the
-- teammate who recorded it (the name is just cleared). Production had the
-- link without that, so removing such a teammate failed.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'portal_payments_recorded_by_fkey'
      and conrelid = 'public.portal_payments'::regclass
      and confdeltype <> 'n'
  ) then
    alter table public.portal_payments drop constraint portal_payments_recorded_by_fkey;
    alter table public.portal_payments
      add constraint portal_payments_recorded_by_fkey
      foreign key (recorded_by) references public.profiles (id) on delete set null;
  end if;
end
$$;

-- create_lead_for_unknown_caller is for the server only (0129, repeated
-- in 0150). Production's copy of the function was put in separately from
-- these files (it differs in comments only), so its execute rights are
-- restated here to match them. If they already match, nothing changes.
revoke all on function public.create_lead_for_unknown_caller(uuid, text, text, text, text, text, text) from public;
revoke all on function public.create_lead_for_unknown_caller(uuid, text, text, text, text, text, text) from anon;
revoke all on function public.create_lead_for_unknown_caller(uuid, text, text, text, text, text, text) from authenticated;
grant execute on function public.create_lead_for_unknown_caller(uuid, text, text, text, text, text, text) to service_role;

-- The table 0182 adds gets what every company table has: the unpaid-
-- account lock (0175) and the same-company check on its contact (0189).
-- Both were applied in production before that table existed.
select public.apply_billing_lock_policies();
select public.apply_lead_company_checks();

-- Check: every column should read true.
select
  exists (select 1 from pg_policies where tablename = 'leads' and policyname = 'leads_update'
          and qual like '%Call Center%') as call_center_can_edit,
  exists (select 1 from information_schema.columns
          where table_name = 'call_logs' and column_name = 'transcript_sid') as ai_call_notes_ready,
  to_regproc('public.dispatch_rollup') is not null as dispatch_summary_ready,
  exists (select 1 from pg_policies where tablename = 'lead_file_deletions'
          and policyname = 'billing_lock') as deleted_files_log_ready,
  exists (select 1 from pg_constraint where conname = 'portal_payments_recorded_by_fkey'
          and confdeltype = 'n') as payment_recorder_can_leave,
  not has_function_privilege('authenticated',
    'public.create_lead_for_unknown_caller(uuid, text, text, text, text, text, text)', 'execute')
    as new_caller_function_locked;
