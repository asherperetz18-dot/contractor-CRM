begin;

-- AI call notes: when a recorded call finishes, the recording is
-- transcribed by Twilio Voice Intelligence (on the same Twilio account
-- that made the recording, so per-company billing holds) and Claude
-- turns the transcript into a note on the contact's timeline -- the
-- note the rep would have typed, written without the rep typing.

-- The company switch, off by default: transcription costs real money
-- per minute, so a company opts in next to the other AI settings.
alter table company_profile add column ai_call_notes_enabled boolean not null default false;

-- The Voice Intelligence service that owns this company's transcripts.
-- Created through the API on first use and remembered here; one per
-- company even when several companies share the platform Twilio account.
alter table company_profile add column twilio_vi_service_sid text;

-- The transcript requested for this call, written when the recording
-- lands. The completion webhook looks the call up by this sid -- a sid
-- we never stored is a sid we never asked for, and is ignored.
alter table call_logs add column transcript_sid text;

-- When the AI note was written, doubling as the idempotency guard:
-- Twilio retries webhooks, and a retry must not produce a second note.
alter table call_logs add column ai_note_at timestamptz;

create index call_logs_transcript_sid_idx on call_logs (transcript_sid);

commit;
