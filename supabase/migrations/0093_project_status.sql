begin;

-- Whether a sold job is running or paused. Only On Hold needs storing:
-- Cancelled is what a voided contract already is, and Complete is what
-- a signed completion certificate already proves -- deriving those
-- keeps them impossible to contradict. On Hold is a human decision with
-- no document behind it, so it gets the column.
alter table estimates
  add column if not exists project_on_hold boolean not null default false;

commit;
