begin;

-- Where inbound calls to the company's Twilio number should ring.
-- Blank means don't forward, which is also the safe default: nobody
-- starts receiving calls on their mobile because a column appeared.
alter table company_profile
  add column call_forward_number text,
  -- Rings this long before giving up. Twilio's own default is 30s, which
  -- is long enough that most callers hang up first.
  add column call_forward_timeout integer not null default 25;

commit;
