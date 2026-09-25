-- Invoices: bill a customer for a cost like a permit fee.
--
-- An invoice is an estimates row with kind = 'invoice' (kind is plain
-- text, no constraint to widen). Its lines are estimate_items. This adds
-- the one thing those rows can't say yet: which job cost a line bills
-- back, so the same permit can't be invoiced twice and the customer can
-- see the city's receipt under the charge.
--
-- Safe to run more than once. Until it runs, invoices still work: lines
-- save without the link, and "Bill to client" can't tell a cost was
-- already billed.

alter table estimate_items
  add column if not exists source_expense_id uuid
    references job_expenses(id) on delete set null;

-- Per line: show that cost's receipt to the customer, or keep it internal.
alter table estimate_items
  add column if not exists show_source_receipt boolean not null default true;

create index if not exists estimate_items_source_expense_idx
  on estimate_items (source_expense_id) where source_expense_id is not null;

-- Proof: both columns exist.
select column_name, data_type
from information_schema.columns
where table_name = 'estimate_items'
  and column_name in ('source_expense_id', 'show_source_receipt')
order by column_name;
