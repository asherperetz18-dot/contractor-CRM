-- AI receptionist: transfer-to-a-human number.
--
-- One optional per-company column. Blank/NULL means the transfer
-- feature is off and the AI never offers it. When set, a caller who
-- asks for a person (or presses 0) gets dialed through to this number;
-- if nobody answers, the AI resumes the call and keeps taking details.
--
-- The pickup-time control shipping alongside this reuses the existing
-- company_profile.call_forward_timeout column — no new column needed.
--
-- The code ships dark before this runs: the engine reads the column
-- tolerantly (a missing column just disables transfers), and the
-- settings form flags the field until this migration is pasted.
--
-- Idempotent; safe as one paste and safe to run twice.

begin;

alter table company_profile
  add column if not exists ai_receptionist_transfer_number text;

commit;
