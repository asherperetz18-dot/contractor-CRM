-- Job files, receipts and company documents move to private storage
-- (DECISIONS #108).
--
-- Both buckets were created public (0024 lead-files, 0073 company-docs)
-- and every saved link was a permanent public URL: anyone holding one --
-- a forwarded email, a former employee, a customer's old browser tab --
-- could open the file for ever, signed in or not. The CRM now saves an
-- address of its own, /api/files/<bucket>/<path>, which checks who is
-- asking and only then redirects to a signed link that expires.
--
--   1. Every saved public link is rewritten to that address, keeping the
--      object path exactly as Supabase encoded it. Links to Google Drive
--      and anything else are left alone. Safe to run twice: a rewritten
--      link no longer matches.
--   2. Both buckets are switched to private, so the old public URLs stop
--      working everywhere at once.
--   3. Rows the file route can't authorise -- a link with no saved path,
--      or a public link in a shape step 1 didn't recognise -- are counted
--      as WARNING lines, not changed. Send any WARNING lines to Claude.
--
-- Logos stay public: the portal shows one before the customer signs in.
--
-- RUN THIS AFTER the version with /api/files (v1.179.0) is live. Run
-- earlier, the rewritten links point at a route the old version doesn't
-- have, and pictures stay blank until the deploy lands.

begin;

update public.lead_files
  set file_url = regexp_replace(file_url, '^https?://[^/]+/storage/v1/object/public/lead-files/', '/api/files/lead-files/')
  where file_url ~ '^https?://[^/]+/storage/v1/object/public/lead-files/';

update public.company_documents
  set file_url = regexp_replace(file_url, '^https?://[^/]+/storage/v1/object/public/company-docs/', '/api/files/company-docs/')
  where file_url ~ '^https?://[^/]+/storage/v1/object/public/company-docs/';

update public.job_expenses
  set receipt_url = regexp_replace(receipt_url, '^https?://[^/]+/storage/v1/object/public/lead-files/', '/api/files/lead-files/')
  where receipt_url ~ '^https?://[^/]+/storage/v1/object/public/lead-files/';

update public.vendor_bills
  set receipt_url = regexp_replace(receipt_url, '^https?://[^/]+/storage/v1/object/public/lead-files/', '/api/files/lead-files/')
  where receipt_url ~ '^https?://[^/]+/storage/v1/object/public/lead-files/';

update storage.buckets set public = false
  where id in ('lead-files', 'company-docs');

commit;

do $$
declare
  n bigint;
begin
  select count(*) into n from public.lead_files
    where file_url like '/api/files/%' and file_path is null;
  if n > 0 then raise warning 'lead_files: % file(s) have no saved path and will not open', n; end if;

  select count(*) into n from public.company_documents
    where file_url like '/api/files/%' and file_path is null;
  if n > 0 then raise warning 'company_documents: % document(s) have no saved path and will not open', n; end if;

  select count(*) into n from public.job_expenses
    where receipt_url like '/api/files/%' and receipt_path is null;
  if n > 0 then raise warning 'job_expenses: % receipt(s) have no saved path and will not open', n; end if;

  select count(*) into n from public.vendor_bills
    where receipt_url like '/api/files/%' and receipt_path is null;
  if n > 0 then raise warning 'vendor_bills: % receipt(s) have no saved path and will not open', n; end if;

  select
    (select count(*) from public.lead_files where file_url like '%/storage/v1/object/public/%')
    + (select count(*) from public.company_documents where file_url like '%/storage/v1/object/public/%')
    + (select count(*) from public.job_expenses where receipt_url like '%/storage/v1/object/public/%')
    + (select count(*) from public.vendor_bills where receipt_url like '%/storage/v1/object/public/%')
  into n;
  if n > 0 then raise warning '% saved link(s) still have a public form this migration did not recognise', n; end if;
end $$;
