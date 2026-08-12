-- A photo must outlive the line it was pinned to.
--
-- estimate_files.estimate_item_id cascaded on delete, and
-- saveEstimateItems deleted every line and re-inserted with fresh ids on
-- each save. So attaching a photo to "Dry rot repair" and then editing
-- anything on the estimate destroyed the attachment -- no error, nothing
-- to notice, on the one document where the picture is the justification
-- for the charge.
--
-- Two halves. The action now keeps line ids so an ordinary save touches
-- nothing; this is the other half, for a line that is genuinely removed.
-- Losing the pin is acceptable there. Losing the photograph is not.
alter table estimate_files
  drop constraint if exists estimate_files_estimate_item_id_fkey,
  add constraint estimate_files_estimate_item_id_fkey
    foreign key (estimate_item_id) references estimate_items(id) on delete set null;

-- Proof rather than a success message. 'n' is SET NULL, 'c' is CASCADE.
select conname, confdeltype
from pg_constraint
where conname = 'estimate_files_estimate_item_id_fkey';
