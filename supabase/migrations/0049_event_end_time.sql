-- Appointments only recorded a start time, so a booking could say 9:00 AM
-- but never "9 to 10". Reps and customers had no idea how long to hold.
--
-- Nullable on purpose: existing appointments genuinely have no end time,
-- and inventing one (start + an arbitrary hour) would be fabricating data.
-- Everything that displays a time falls back to showing just the start.

begin;

alter table events add column end_time time;

commit;
