-- Reply Inbox: SMS conversations per lead via Twilio.
create table sms_messages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads (id) on delete set null,
  direction text not null,
  from_number text not null,
  to_number text not null,
  body text not null,
  twilio_sid text,
  created_at timestamptz not null default now()
);

create index sms_messages_lead_id_idx on sms_messages (lead_id);
create index sms_messages_created_at_idx on sms_messages (created_at);

alter table sms_messages enable row level security;

-- Everyone signed in can read the inbox (matches leads_select).
create policy "sms_messages_select" on sms_messages for select
  to authenticated using (true);

-- Only Office/Sales can send, and only as outbound -- inbound rows are
-- written by the Twilio webhook via the service-role client, which
-- bypasses RLS entirely.
create policy "sms_messages_insert_outbound" on sms_messages for insert
  to authenticated with check (
    direction = 'outbound' and (has_role('Office') or has_role('Sales'))
  );
