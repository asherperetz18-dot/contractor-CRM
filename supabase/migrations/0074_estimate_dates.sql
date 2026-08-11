-- Approximate start and completion dates.
--
-- Not cosmetic: California B&P 7159 requires a home improvement contract
-- to state approximate start and completion dates, and the contract
-- template has fields for them that nothing could fill. They belong on
-- the estimate because that is where the job is priced and scheduled,
-- and the contract is generated from it.
--
-- Nullable on purpose. A rep pricing a job on a kitchen counter does not
-- always know the start date yet, and a required field there would be
-- filled with a guess -- which is worse than blank, because a guess looks
-- like a commitment.

alter table estimates add column if not exists start_date date;
alter table estimates add column if not exists completion_date date;

-- Proof rather than a success message.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'estimates'
  and column_name in ('start_date', 'completion_date')
order by column_name;
