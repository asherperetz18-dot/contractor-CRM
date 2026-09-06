-- 0126: "Send Estimates" -- a per-person switch on Users & Roles.
--
-- Until now anyone who could write an estimate could also put it in front
-- of the customer. This splits the two: a rep can keep building and
-- saving drafts while the office reviews and sends. Same shape as
-- can_create_estimates on the same table -- a flag per member, not a new
-- role -- so nothing else about the person's access moves.
--
-- Defaults to TRUE and is added to every existing row as TRUE, so the
-- day this runs nobody loses the ability they had yesterday. The owner
-- then switches it OFF for the specific people who should only draft.
--
-- Office and Admin always send regardless of the flag (the app never
-- offers them the switch), the same way they always hold view and create.
--
-- Where it is enforced: in the server actions that actually email, text
-- or mark a document as sent (sendEstimateToCustomer, markEstimateSent,
-- markSignedOnPaper). The send itself happens on the server, never from
-- the browser, so that is the gate -- a hidden button is not a permission.
--
-- Idempotent; safe as one paste in the Supabase SQL editor, safe to run
-- twice. The select at the end says what landed.

alter table company_members
  add column if not exists can_send_estimates boolean not null default true;

comment on column company_members.can_send_estimates is
  'Users & Roles > Send Estimates. Off = this person can only save drafts; the office sends. Office/Admin always send.';

select
  (select count(*) from information_schema.columns
    where table_name = 'company_members' and column_name = 'can_send_estimates') as column_added,
  (select count(*) from company_members where can_send_estimates) as members_who_can_send,
  (select count(*) from company_members where not can_send_estimates) as members_drafts_only;
