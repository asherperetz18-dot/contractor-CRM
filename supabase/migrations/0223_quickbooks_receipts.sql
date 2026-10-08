-- 0223: QuickBooks -- a bill's receipt goes with it (DECISIONS #174).
--
-- Once bills go to QuickBooks (0222), the receipt attached to a bill in
-- the CRM (a photo or a PDF) is attached to the same bill in QuickBooks,
-- as a Receipt. A receipt replaced in the CRM is replaced there too; a
-- bill voided in the CRM has its receipt taken off before the bill is
-- deleted. Only what the CRM attached is ever removed.
--
--   * quickbooks_sync keeps a row for each receipt as well (record_type
--     'receipt', keyed by its bill's id): QuickBooks' id for the
--     attachment and which file went.
--
-- Only the list of record types changes. Run in the Supabase SQL editor,
-- after 0222. Safe to run twice.

begin;

alter table public.quickbooks_sync drop constraint if exists quickbooks_sync_record_type_check;
alter table public.quickbooks_sync
  add constraint quickbooks_sync_record_type_check check (record_type in ('bill', 'bill_payment', 'receipt'));

commit;

-- Check: should read true.
select exists (
  select 1 from pg_constraint
  where conrelid = 'public.quickbooks_sync'::regclass
    and conname = 'quickbooks_sync_record_type_check'
    and pg_get_constraintdef(oid) like '%receipt%'
) as quickbooks_receipts_ready;
