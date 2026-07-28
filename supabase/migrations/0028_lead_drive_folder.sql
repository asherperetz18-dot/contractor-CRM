-- Tracks the Google Drive subfolder created for a lead's file uploads,
-- so every attachment for that contact lands in one folder instead of
-- being dumped flat into the root "Contractor CRM Files" folder.
alter table leads add column drive_folder_id text;
