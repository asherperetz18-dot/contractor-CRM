-- A note on a checklist step: "gate code 4432", "inspector wants the
-- panel photo first". One line of free text per step, typed on the job
-- board and saved when the box loses focus.
--
-- Nullable with no default: a step with nothing written on it holds
-- null, not an empty string, so "no note" has one representation. No
-- policy change -- the existing project_checklist_items_update policy
-- already lets a company member update the row, and which roles may
-- write the note is decided in the action layer, the same as the
-- planned date and the owner.
begin;

alter table project_checklist_items
  add column if not exists note text;

commit;
