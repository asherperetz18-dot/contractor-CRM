-- 0216: a follow-up task for a financing step (DECISIONS #164).
--
-- When the office sends a customer the lender's link, or marks them
-- Applied, the CRM can put a follow-up task on that person's list a few
-- days out ("did they apply?", "has the lender decided?"). The next step
-- on the estimate closes it.
--
--   * estimate_financing_events.follow_up_task_id: the task a step put on
--     the list, so the next step knows which one to close. Removing the
--     task leaves the step as it was.
--
-- A column is added, nothing is removed: the running code checks for it
-- and offers no reminder without it. Run in the Supabase SQL editor.
-- Safe to run twice.

begin;

alter table public.estimate_financing_events
  add column if not exists follow_up_task_id uuid references public.lead_tasks (id) on delete set null;

comment on column public.estimate_financing_events.follow_up_task_id is
  'The follow-up task this step put on someone''s list (DECISIONS #164); the next step closes it.';

create index if not exists estimate_financing_events_follow_up_idx
  on public.estimate_financing_events (follow_up_task_id)
  where follow_up_task_id is not null;

commit;

-- Check: should read true.
select
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'estimate_financing_events' and column_name = 'follow_up_task_id'
  )
  as financing_follow_ups_ready;
