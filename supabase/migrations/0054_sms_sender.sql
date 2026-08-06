begin;

-- Who sent an outbound text. Messages recorded the lead and the
-- direction but never the person, so "Simon texted this customer" was
-- not answerable -- which left a rep who works mostly by text looking
-- inactive on any per-person activity view.
--
-- Nullable, and deliberately not backfilled: existing outbound messages
-- have no sender on record and guessing one would invent history.
alter table sms_messages add column sent_by uuid references profiles(id) on delete set null;

create index sms_messages_sent_by_idx on sms_messages (sent_by, created_at desc);

commit;
