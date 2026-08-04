begin;

-- Tracks the two automated nudges for an appointment whose outcome was
-- never recorded. Separate stamps because they fire at different times
-- and each must happen at most once: the rep is texted shortly after the
-- appointment, and the lead only moves stage at the end of the day.
--
-- followup_flagged_at (already present) stays the "we created a task"
-- marker. Appointments it flagged before this migration therefore keep a
-- null result_reminder_sent_at and will not be texted about retroactively.
alter table events
  add column result_reminder_sent_at timestamptz,
  add column followup_moved_at timestamptz;

commit;
