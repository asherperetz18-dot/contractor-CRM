begin;

-- What a call outcome does to the lead, decided per disposition rather
-- than hardcoded on names -- dispositions are renameable per company,
-- and a name-match breaks silently the day someone renames one.
--
-- Before this, a disposition was saved onto the call log and nothing
-- else. Pressing "Not Interested" left the lead sitting at "New Lead"
-- on the pipeline, so the buttons read as broken: they worked in a
-- table nobody looks at and did nothing anywhere anyone does.
alter table call_dispositions
  add column if not exists move_to_stage text,
  add column if not exists creates_followup_task boolean not null default false;

-- Sensible defaults, seeded only where the target stage actually exists
-- in that company's pipeline. Deliberately no mapping for "Sale / Won":
-- Won is what a signed contract makes true, not what a phone call says,
-- and the dashboard already carries unsigned "Won" value nobody committed
-- to.
update call_dispositions d
   set move_to_stage = m.stage
  from (values
    ('Connected',       'Contacted'),
    ('Callback',        'Contacted'),
    ('Left Voicemail',  'No Answer'),
    ('No Answer',       'No Answer'),
    ('Appointment Set', 'Appointment Scheduled'),
    ('Not Interested',  'Not Interested'),
    ('Wrong Number',    'DNC')
  ) as m(name, stage)
 where d.name = m.name
   and d.move_to_stage is null
   and exists (
     select 1 from pipeline_stages s
      where s.company_id = d.company_id and s.name = m.stage
   );

-- A callback nobody is reminded of is a lost lead.
update call_dispositions set creates_followup_task = true where name = 'Callback';

-- Proof rather than a success message.
select name, move_to_stage, creates_followup_task
  from call_dispositions order by company_id, sort_order;

commit;
