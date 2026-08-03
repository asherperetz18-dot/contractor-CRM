-- "Not Interested" existed only in La Home Contractor, so the one-click
-- button for it would have been missing (or dead) in the other companies.
-- Add it everywhere, in the same position it already occupies there:
-- ... Won, Lost, Not Interested, DNC.
--
-- Written to be safe to re-run: companies that already have the stage are
-- left completely alone, including their ordering.

begin;

-- Make room at position 15 -- only in companies that are actually getting
-- the new stage, so existing ordering elsewhere is untouched.
update pipeline_stages ps
set sort_order = ps.sort_order + 1
where ps.sort_order >= 15
  and not exists (
    select 1 from pipeline_stages existing
    where existing.company_id = ps.company_id
      and existing.name = 'Not Interested'
  );

insert into pipeline_stages (company_id, name, color, sort_order, is_system)
select c.id, 'Not Interested', '#ea2610', 15, false
from companies c
where not exists (
  select 1 from pipeline_stages p
  where p.company_id = c.id
    and p.name = 'Not Interested'
);

commit;
