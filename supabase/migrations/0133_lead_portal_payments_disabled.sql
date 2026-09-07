-- 0133: per-client switch to turn the portal's online payments off.
--
-- Some customers are invoiced from QuickBooks, and two live "pay here"
-- buttons for the same money is how a customer double-pays or calls to
-- ask which one is real. Flipping this ON for a client keeps their
-- portal exactly as it is -- documents, signing, phase schedule -- but
-- shows "invoiced separately" where the Pay buttons were, and the
-- checkout actions refuse server-side (a stale open tab can't pay
-- either).
--
-- Default FALSE: nobody's portal changes when this runs. The switch
-- lives on the client card, next to the portal-link controls.
--
-- Idempotent; safe as one paste and safe to run twice.

alter table leads
  add column if not exists portal_payments_disabled boolean not null default false;

comment on column leads.portal_payments_disabled is
  'Client card > Online payments switched off. On = the portal shows this client no Stripe pay buttons (they are invoiced elsewhere, e.g. QuickBooks); signing and documents are untouched.';

select
  (select count(*) from information_schema.columns
    where table_name = 'leads' and column_name = 'portal_payments_disabled') as column_added,
  (select count(*) from leads where portal_payments_disabled) as clients_switched_off;
