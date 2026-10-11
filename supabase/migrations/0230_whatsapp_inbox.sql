-- 0230: the WhatsApp Inbox (DECISIONS #204).
--
-- Besides each job's group, a company often has one general WhatsApp
-- group -- receipts, supply runs, odd photos -- that is no single job.
-- Such a group is linked as kind 'general', on no job, and each photo or
-- file it posts is copied into the company's own inbox folder, waiting
-- to be filed to a job, made into a bill, or dismissed.
--
--   * whatsapp_group_links.kind: 'job' (on estimate_id, as before) or
--     'general' (no estimate). The select policy grows a second arm: a
--     general group is read by the company's Office, Admin and Production
--     people, who sort the inbox. A job group is still read by whoever
--     can see its job. Messages follow their group's link, unchanged.
--   * whatsapp_group_messages: where the inbox copy is (media_path), and
--     how it was sorted: inbox_status filed/dismissed (null = to sort),
--     filed as a job file or a bill, on which job, by whom, when.
--
-- Nothing is removed. Run in the Supabase SQL editor. Safe to run twice.

begin;

alter table public.whatsapp_group_links
  add column if not exists kind text not null default 'job';
alter table public.whatsapp_group_links drop constraint if exists whatsapp_group_links_kind_check;
alter table public.whatsapp_group_links
  add constraint whatsapp_group_links_kind_check check (kind in ('job', 'general'));

-- A general group is on no job; a job group always is.
alter table public.whatsapp_group_links alter column estimate_id drop not null;
alter table public.whatsapp_group_links drop constraint if exists whatsapp_group_links_estimate_kind_check;
alter table public.whatsapp_group_links
  add constraint whatsapp_group_links_estimate_kind_check check ((kind = 'job') = (estimate_id is not null));

drop policy if exists whatsapp_group_links_select on public.whatsapp_group_links;
create policy whatsapp_group_links_select on public.whatsapp_group_links for select
  to authenticated
  using (
    company_id in (select public.current_member_company_ids())
    and (
      exists (select 1 from public.estimates e where e.id = whatsapp_group_links.estimate_id)
      or (
        kind = 'general'
        and (has_role_in_company('Office', company_id) or has_role_in_company('Production', company_id))
      )
    )
  );

alter table public.whatsapp_group_messages
  add column if not exists media_path text;
alter table public.whatsapp_group_messages
  add column if not exists inbox_status text check (inbox_status in ('filed', 'dismissed'));
alter table public.whatsapp_group_messages
  add column if not exists inbox_filed_as text check (inbox_filed_as in ('job_file', 'bill'));
alter table public.whatsapp_group_messages
  add column if not exists inbox_estimate_id uuid references public.estimates (id) on delete set null;
alter table public.whatsapp_group_messages
  add column if not exists inbox_by uuid references public.profiles (id) on delete set null;
alter table public.whatsapp_group_messages
  add column if not exists inbox_at timestamptz;

-- Opening an inbox file finds its message by where the file is.
create index if not exists whatsapp_group_messages_media_path_idx
  on public.whatsapp_group_messages (media_path)
  where media_path is not null;

commit;

-- Check: should read true.
select
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'whatsapp_group_links' and column_name = 'kind')
  and exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'whatsapp_group_messages' and column_name = 'inbox_status')
  as whatsapp_inbox_ready;
