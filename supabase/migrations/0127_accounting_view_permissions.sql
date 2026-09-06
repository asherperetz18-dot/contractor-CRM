-- 0127: the two Accounting switches on Users & Roles.
--
-- "View Financials" covers the money screens that already exist -- Bills
-- to Pay, Money to Collect, Payments. "View Profit & Loss" covers the
-- P&L report, which is coming next. They are separate on purpose: an
-- office admin can chase receivables all day without being shown what
-- the company earns.
--
-- Same shape as can_send_estimates (0126) -- a flag per member, not a
-- new role -- so nothing else about a person's access moves.
--
-- The DIFFERENCE from 0126 is the default. Send Estimates defaulted TRUE
-- so nobody lost an ability they already had. These default FALSE,
-- because company money is the most sensitive thing in the CRM and the
-- safe answer to "should this person see it?" is no until someone says
-- yes. The owner then switches it ON for the specific people who need it.
--
-- Nobody loses access by running this. Office, Admin and Bookkeeping
-- hold financial access by ROLE (canManageBills), and the rules read the
-- role first -- the flag can only ever grant access to someone who did
-- not already have it. So a FALSE default is safe on every existing row.
--
-- Where it is enforced: in the server components and server actions that
-- read the money, not in the sidebar. A hidden link is not a permission.
--
-- Idempotent; safe as one paste in the Supabase SQL editor, safe to run
-- twice. The select at the end says what landed.

alter table company_members
  add column if not exists can_view_financials boolean not null default false;

alter table company_members
  add column if not exists can_view_profit_loss boolean not null default false;

comment on column company_members.can_view_financials is
  'Users & Roles > View Financials. On = this person may open Bills to Pay, Money to Collect and Payments. Office/Admin/Bookkeeping always may, whatever this says.';

comment on column company_members.can_view_profit_loss is
  'Users & Roles > View Profit & Loss. On = this person may open the P&L report. Needs View Financials too. Office/Admin always may, whatever this says.';

select
  (select count(*) from information_schema.columns
    where table_name = 'company_members' and column_name = 'can_view_financials') as financials_column_added,
  (select count(*) from information_schema.columns
    where table_name = 'company_members' and column_name = 'can_view_profit_loss') as profit_loss_column_added,
  (select count(*) from company_members where can_view_financials) as members_granted_financials,
  (select count(*) from company_members where can_view_profit_loss) as members_granted_profit_loss;
