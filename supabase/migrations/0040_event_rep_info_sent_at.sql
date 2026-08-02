-- Tracks when the "Text Rep Info" SMS was actually sent for the primary
-- and second assigned reps, so the UI can show a persistent confirmation
-- instead of a status that resets when the appointment is reopened.

begin;

alter table events add column rep_info_sent_at timestamptz;
alter table events add column second_rep_info_sent_at timestamptz;

commit;
