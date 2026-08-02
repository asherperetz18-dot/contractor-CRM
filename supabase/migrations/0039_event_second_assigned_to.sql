-- Adds an optional second assigned rep to appointments, so a job that
-- needs two people (e.g. a lead helper) can be texted appointment info
-- the same way the primary assigned rep already can be.

begin;

alter table events add column second_assigned_to uuid references profiles(id) on delete set null;

commit;
