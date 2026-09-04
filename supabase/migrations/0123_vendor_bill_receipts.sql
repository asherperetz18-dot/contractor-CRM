-- Bills and receipts are one thing: money going out on a job. A receipt
-- is just a bill that was already paid. Until now the two halves lived
-- apart -- a bill could carry no file, and could not say which phase of
-- the job it belonged to, so the same $6,000 showed up once as an open
-- bill and once as a paid cost with nothing tying them together.
--
-- Two additions to vendor_bills:
--   * receipt_url / receipt_path -- the photo or PDF behind the bill,
--     same pair job_expenses carries. Copied onto the job cost when the
--     bill is paid, so the thumbnail follows the money.
--   * estimate_payment_id -- the phase of the job the bill is filed to,
--     nullable like on job_expenses. Lets Job costs show what is still
--     unpaid per phase, and the payment lands on the right phase without
--     anyone re-filing it.
--
-- Idempotent; safe as one paste and safe to run twice.

begin;

alter table vendor_bills add column if not exists receipt_url text;
alter table vendor_bills add column if not exists receipt_path text;
alter table vendor_bills
  add column if not exists estimate_payment_id uuid references estimate_payments (id) on delete set null;

create index if not exists vendor_bills_phase_idx
  on vendor_bills (estimate_payment_id) where estimate_payment_id is not null;

commit;
