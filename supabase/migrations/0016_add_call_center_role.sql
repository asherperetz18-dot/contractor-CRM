-- New role scoped to Your Sales Center only (Power Dialer + Call Reports),
-- for staff who should only make calls, not see Dispatch/Production/etc.
-- Split into its own migration -- Postgres won't let a newly-added enum
-- value be referenced by policies in the same transaction it was added in
-- (same reasoning as 0006_add_admin_sales_roles.sql).

alter type app_role add value 'Call Center';
