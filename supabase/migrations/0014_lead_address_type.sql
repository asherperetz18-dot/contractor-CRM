-- Power Dialer's ADDRESS TYPE filter (verified against the real product):
-- All / Office (commercial) / Residence (residential) / PO Box /
-- Mailbox (CMRA) / Unknown / Unverified. The real product appears to
-- populate this from an address-verification service; we don't have
-- that integration, so it defaults to 'Unverified' and can be set
-- manually for now.
alter table leads add column address_type text not null default 'Unverified';
