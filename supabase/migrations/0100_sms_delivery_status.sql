begin;

-- What Twilio's status callback reported for an outbound text.
--
-- Values follow Twilio's MessageStatus: queued / accepted / sending /
-- sent are in flight, 'delivered' is carrier-confirmed on the phone,
-- 'undelivered' and 'failed' mean it never arrived. Null on inbound
-- rows and on anything sent before callbacks existed -- a null renders
-- as no mark at all, never as a claim either way.
alter table sms_messages add column delivery_status text;

-- Twilio's numeric error code when delivery failed (30006 landline,
-- 30003 unreachable, ...), so a failure can say why instead of just
-- that.
alter table sms_messages add column delivery_error text;

-- The status callback identifies a message only by its Twilio SID.
create index sms_messages_twilio_sid_idx on sms_messages (twilio_sid)
  where twilio_sid is not null;

commit;
