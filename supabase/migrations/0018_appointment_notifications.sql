-- Appointment Notifications (matches the real iBuildPro product, minus the
-- WhatsApp portion which needs a separate WhatsApp Business API connection
-- this app doesn't have): automatic no-show/cancelled follow-up rules, and
-- the Appointment SMS Quick-Texts (Confirm/Reschedule/On my way/Running
-- late) sent from an appointment via the existing Twilio SMS integration.

alter table company_profile add column no_show_followup_enabled boolean not null default false;
alter table company_profile add column no_show_grace_minutes int not null default 60;
alter table company_profile add column no_show_lookback_hours int not null default 168;

-- Marks an appointment as already processed by the no-show follow-up cron,
-- so it's never flagged twice.
alter table events add column followup_flagged_at timestamptz;

create table sms_quick_texts (
  key text primary key,
  label text not null,
  description text not null,
  body text
);

insert into sms_quick_texts (key, label, description, body) values
  ('confirm', 'Confirm', 'Reminder asking the customer to reply YES to confirm their appointment.', null),
  ('reschedule', 'Reschedule', 'Tells the customer their appointment needs to be rescheduled.', null),
  ('on_my_way', 'On my way', 'Lets the customer know the rep is en route.', null),
  ('running_late', 'Running late', 'Warns the customer the rep is running a bit behind.', null);

alter table sms_quick_texts enable row level security;

create policy "sms_quick_texts_select" on sms_quick_texts for select
  to authenticated using (true);
create policy "sms_quick_texts_write" on sms_quick_texts for all
  to authenticated using (has_role('Office') or has_role('Admin'))
  with check (has_role('Office') or has_role('Admin'));
