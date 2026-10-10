-- 0229: a job's WhatsApp group is either the client's or the crew's
-- (DECISIONS #198).
--
-- Photos, videos and documents copied from a job's WhatsApp group are
-- lead files, and the customer portal shows a lead's files. A crew-only
-- group's files must stay office-only, so each linked group now says
-- whether it is the client's: only those groups' files reach the portal.
-- Default false -- a group stays office-only until someone marks it,
-- and every group linked before this ran starts office-only.
--
-- The portal looks a file's group up by its lead file, hence the index.
--
-- Nothing is removed. Run in the Supabase SQL editor. Safe to run twice.

begin;

alter table public.whatsapp_group_links
  add column if not exists show_to_client boolean not null default false;

create index if not exists whatsapp_group_messages_lead_file_idx
  on public.whatsapp_group_messages (lead_file_id)
  where lead_file_id is not null;

commit;

-- Check: should read true.
select exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'whatsapp_group_links' and column_name = 'show_to_client'
) as whatsapp_client_files_ready;
