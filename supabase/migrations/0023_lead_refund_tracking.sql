-- Lead cost + refund tracking, matching iBuildPro's "Lead Refund (RTP)"
-- flow: leads bought from a paid vendor (e.g. Ca Pro Guarantee) can have
-- a refund requested if the lead was bad, then marked received or denied
-- once the vendor responds.
alter table leads
  add column lead_cost numeric,
  add column refund_status text not null default 'None',
  add column refund_requested_at timestamptz;

alter table leads
  add constraint leads_refund_status_check
  check (refund_status in ('None', 'Requested', 'Received', 'Denied'));
