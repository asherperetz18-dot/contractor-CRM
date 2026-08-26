begin;

-- Where the work happens, when that isn't the client's own address --
-- an investor with three properties signs each contract for a
-- different site. Null means the client's address, which keeps the
-- common case zero-effort. California home improvement contracts are
-- required to state the address where the work will be done, so on a
-- multi-property client this is a compliance fix, not a nicety.
alter table estimates add column job_address text;

commit;
