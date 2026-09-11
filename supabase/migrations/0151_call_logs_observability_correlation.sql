begin;

-- Links a call_logs row to its observability trace, so a call a rep
-- flags as broken can be looked up in Sentry (and the structured logs,
-- by the same id) without reproducing it live. Both nullable: most calls
-- never error, and older rows predate this entirely. No new RLS policy
-- needed -- same table, same existing company-scoped policy.

-- Minted client-side per call attempt and carried through Twilio's own
-- webhooks as a form field (there's no header Twilio will forward for
-- us) -- see voice-dialer.tsx and src/lib/observability/context.ts.
alter table call_logs add column correlation_id text;

-- Set only when the call actually errored (call.on("error") in
-- voice-dialer.tsx) -- the direct link to that Sentry issue.
alter table call_logs add column sentry_event_id text;

create index call_logs_correlation_id_idx on call_logs (correlation_id);

commit;
