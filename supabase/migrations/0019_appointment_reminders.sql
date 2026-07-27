-- SMS appointment reminders to the assigned rep: night-before and
-- 1-hour-before. These columns mark an appointment as already reminded so
-- the cron (running every 15 min) never sends either reminder twice.
alter table events add column reminder_night_before_sent_at timestamptz;
alter table events add column reminder_hour_before_sent_at timestamptz;
