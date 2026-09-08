-- Rain warnings on projects, not just appointments: the rain-alerts cron
-- now also checks each active weather-sensitive project's job-site address
-- for the next 48h, so a pool remodel warns about tomorrow's rain even when
-- no appointment is on the calendar. Same column pair events got in 0135.

alter table estimates
  add column rain_alert_sent_at timestamptz,
  add column rain_alert_pop smallint;
