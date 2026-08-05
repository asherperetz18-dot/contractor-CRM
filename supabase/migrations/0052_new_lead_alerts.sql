begin;

-- Who gets told when a lead arrives through an automated intake (Meta
-- lead ads, Zapier, a website form) with nobody watching the screen.
-- Comma-separated numbers rather than a join table: this is a short list
-- of internal phones, edited by hand in Settings.
alter table company_profile
  add column new_lead_alert_phones text,
  -- A ceiling on texts per company per day. A Zapier replay or a bulk
  -- re-sync can push hundreds of leads through the webhook in a minute;
  -- without this that becomes hundreds of texts and a Twilio bill.
  add column new_lead_alert_daily_cap integer not null default 50,
  add column new_lead_alert_count integer not null default 0,
  add column new_lead_alert_count_date date;

commit;
