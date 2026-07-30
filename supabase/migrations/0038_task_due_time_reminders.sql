-- Adds an optional due time to follow-up tasks (previously date-only) and
-- a sent-at tracking column, so a cron can text the assigned rep 2 hours
-- before a task is due -- mirrors events.reminder_hour_before_sent_at.
-- due_time is nullable: tasks without a specific time don't get this
-- reminder (there's no meaningful "2 hours before" for an all-day task).

begin;

alter table lead_tasks add column due_time time;
alter table lead_tasks add column reminder_2h_sent_at timestamptz;

commit;
