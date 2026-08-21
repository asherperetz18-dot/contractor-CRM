-- 0098: which Drive PDF mirrors each document, and when it was
-- rendered -- so the backup can tell a stale copy from a missing one.
alter table estimates
  add column if not exists drive_pdf_id text,
  add column if not exists drive_pdf_synced_at timestamptz;
