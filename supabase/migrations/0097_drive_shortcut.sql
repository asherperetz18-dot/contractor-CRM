-- 0097: Drive category-folder shortcut id per file, so the backfill
-- and the upload hand-off stay idempotent.
alter table lead_files
  add column if not exists drive_shortcut_id text;
