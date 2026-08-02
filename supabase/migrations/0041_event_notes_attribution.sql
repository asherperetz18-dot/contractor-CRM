-- Tracks who last edited the free-text "Appointment Notes" field on an
-- event, and when, so the UI can show attribution the same way lead
-- notes already do.

begin;

alter table events add column notes_updated_by uuid references profiles(id) on delete set null;
alter table events add column notes_updated_at timestamptz;

commit;
