-- 0228: project WhatsApp groups (DECISIONS #193).
--
-- A company puts one dedicated WhatsApp number -- the "project bot" --
-- into each project's WhatsApp group, connected through Whapi.Cloud.
-- Every message that number sees is posted to /api/whatsapp/webhook;
-- the ones from a group linked to a project show on that project, and
-- their photos/videos/documents are copied into the project's files.
--
--   * whatsapp_connections: one per company. Whapi's API token and the
--     webhook's secret, both encrypted by the server (the key lives only
--     there), like the Stripe, Twilio and QuickBooks keys. RLS on, no
--     policies, no rights for anon/authenticated: server only.
--   * whatsapp_group_links: which project (contract) a group belongs to.
--     A group is on one project; a project can have several groups (one
--     with the client, one for the crew). Read by whoever can see the
--     project; written only by the server, after its own role check.
--   * whatsapp_group_messages: every group message the bot number has
--     seen, linked or not yet -- linking a group later shows what was
--     already said. One row per WhatsApp message id, so Whapi's retries
--     never double a message. Read by whoever can see the project the
--     group is on; written only by the server.
--
-- Tables are added, nothing is removed. Run in the Supabase SQL editor.
-- Safe to run twice.

begin;

create table if not exists public.whatsapp_connections (
  company_id uuid primary key references public.companies (id) on delete cascade,
  api_token_enc text,
  webhook_token_enc text,
  -- The bot number as Whapi reports it, for the settings page.
  phone text,
  connected_by uuid references public.profiles (id) on delete set null,
  connected_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.whatsapp_connections is
  'Each company''s project-bot WhatsApp number via Whapi.Cloud (DECISIONS #193). Secrets encrypted; server only.';

alter table public.whatsapp_connections enable row level security;
revoke all on public.whatsapp_connections from anon, authenticated;

create table if not exists public.whatsapp_group_links (
  company_id uuid not null references public.companies (id) on delete cascade,
  -- WhatsApp's id for the group, ending in @g.us.
  group_id text not null,
  group_name text not null default '',
  -- The project: its signed contract. Deleting the contract unlinks the
  -- group; its messages stay.
  estimate_id uuid not null references public.estimates (id) on delete cascade,
  linked_by uuid references public.profiles (id) on delete set null,
  linked_at timestamptz not null default now(),
  primary key (company_id, group_id)
);

create index if not exists whatsapp_group_links_estimate_idx
  on public.whatsapp_group_links (estimate_id);

comment on table public.whatsapp_group_links is
  'Which project (contract) each WhatsApp group belongs to (DECISIONS #193). Server writes only.';

alter table public.whatsapp_group_links enable row level security;
revoke insert, update, delete on public.whatsapp_group_links from anon, authenticated;
-- Seen by whoever can see the project itself: the subquery runs under
-- estimates' own RLS, so a rep scoped to their own customers sees only
-- those customers' groups.
drop policy if exists whatsapp_group_links_select on public.whatsapp_group_links;
create policy whatsapp_group_links_select on public.whatsapp_group_links for select
  to authenticated
  using (
    company_id in (select public.current_member_company_ids())
    and exists (select 1 from public.estimates e where e.id = whatsapp_group_links.estimate_id)
  );

create table if not exists public.whatsapp_group_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  group_id text not null,
  wa_message_id text not null,
  -- Digits as WhatsApp gave them; null when it hid the number.
  sender_phone text,
  sender_name text,
  from_me boolean not null default false,
  kind text not null check (kind in ('text', 'image', 'video', 'document', 'audio')),
  -- The text, or a photo's caption.
  body text,
  -- Whapi's id for the file; the copy is made after the webhook answers.
  media_id text,
  media_type text,
  media_name text,
  media_size bigint,
  -- none: no file. pending: waiting to be copied (or its group isn't on
  -- a project yet). saving: being copied now. saved: in the project's
  -- files. failed / too_large: left in WhatsApp.
  media_status text not null default 'none'
    check (media_status in ('none', 'pending', 'saving', 'saved', 'failed', 'too_large')),
  media_attempts int not null default 0,
  media_claimed_at timestamptz,
  lead_file_id uuid references public.lead_files (id) on delete set null,
  sent_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (company_id, wa_message_id)
);

create index if not exists whatsapp_group_messages_group_idx
  on public.whatsapp_group_messages (company_id, group_id, sent_at desc);

create index if not exists whatsapp_group_messages_pending_idx
  on public.whatsapp_group_messages (company_id, created_at)
  where media_status in ('pending', 'saving');

comment on table public.whatsapp_group_messages is
  'Messages from the project-bot number''s WhatsApp groups (DECISIONS #193). Server writes only.';

alter table public.whatsapp_group_messages enable row level security;
revoke insert, update, delete on public.whatsapp_group_messages from anon, authenticated;
-- A message is seen by whoever can see its group's link (above), so by
-- whoever can see the project. A group on no project is read by the
-- server only.
drop policy if exists whatsapp_group_messages_select on public.whatsapp_group_messages;
create policy whatsapp_group_messages_select on public.whatsapp_group_messages for select
  to authenticated
  using (
    company_id in (select public.current_member_company_ids())
    and exists (
      select 1 from public.whatsapp_group_links l
      where l.company_id = whatsapp_group_messages.company_id
        and l.group_id = whatsapp_group_messages.group_id
    )
  );

-- Every company table carries the subscription lock (0175).
select public.apply_billing_lock_policies();

commit;

-- Check: should read true.
select
  exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'whatsapp_connections')
  and exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'whatsapp_group_links')
  and exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'whatsapp_group_messages')
  as whatsapp_groups_ready;
