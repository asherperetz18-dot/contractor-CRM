-- New roles alongside the existing Office/Field: Admin (Admin Settings
-- access) and Sales (Dispatch section access). Split into its own
-- migration because Postgres won't let a newly-added enum value be
-- referenced by policies in the same transaction it was added in.

alter type app_role add value 'Admin';
alter type app_role add value 'Sales';
