-- Notes shared between the team and the client, shown in the client
-- portal's Notes tab and on the lead card's Notes > Shared with client.
--
-- A separate table on purpose, not a "visible to client" flag on
-- lead_notes: lead_notes is the team's internal timeline ("price-
-- sensitive, push the upgrade"), and the portal reads with the service
-- role. With a flag, one query that forgot the filter would show the
-- client every internal note. Here the portal reads a table that only
-- ever holds what the client may see.
--
-- Who writes what:
--   * The client adds notes through the portal (service role, scoped in
--     code to the signed-in customer's own lead). Client notes can't be
--     edited once posted -- the portal offers no edit, and the guard
--     trigger below refuses a body change from anyone but the author.
--   * Office, Sales and Field (Admin implied) add notes, pin them, and
--     answer the client's questions. A staff member may edit the text of
--     only their own notes (enforced by the trigger, not just the UI).
--   * No delete policy: this is the written record of the project.
--
-- Visibility follows the lead: the same select rule as lead_notes, so a
-- sales-scoped rep sees shared notes only on the customers they can see.
--
-- Idempotent; safe as one paste and safe to run twice.

begin;

create table if not exists lead_shared_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  lead_id uuid not null references leads (id) on delete cascade,
  author_kind text not null check (author_kind in ('staff', 'client')),
  author_id uuid references profiles (id) on delete set null,
  body text not null check (char_length(body) between 1 and 4000),
  kind text check (kind in ('decision', 'selection', 'question', 'todo')),
  pinned boolean not null default false,
  answer text check (answer is null or char_length(answer) <= 4000),
  answered_by uuid references profiles (id) on delete set null,
  answered_at timestamptz,
  edited_at timestamptz,
  staff_seen_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.lead_shared_notes is
  'Notes the client can see: written by the client in the portal or by the team on the lead card. Internal notes stay in lead_notes.';

create index if not exists lead_shared_notes_lead_idx
  on lead_shared_notes (lead_id, created_at desc);

-- The popup watcher and the bell ask "client notes since X" per company.
create index if not exists lead_shared_notes_client_recent_idx
  on lead_shared_notes (company_id, created_at desc)
  where author_kind = 'client';

-- Authorship and placement never change after insert; the text of a
-- note changes only at the hands of its own staff author.
create or replace function public.lead_shared_notes_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.company_id is distinct from old.company_id
     or new.lead_id is distinct from old.lead_id
     or new.author_kind is distinct from old.author_kind
     or new.author_id is distinct from old.author_id
     or new.created_at is distinct from old.created_at then
    raise exception 'A shared note''s author and customer cannot be changed.';
  end if;
  if (new.body is distinct from old.body or new.kind is distinct from old.kind)
     and (auth.uid() is null or old.author_id is distinct from auth.uid()) then
    raise exception 'Only the person who wrote a note can edit it.';
  end if;
  return new;
end;
$$;

drop trigger if exists lead_shared_notes_guard on lead_shared_notes;
create trigger lead_shared_notes_guard
  before update on lead_shared_notes
  for each row execute function public.lead_shared_notes_guard();

alter table lead_shared_notes enable row level security;

drop policy if exists "lead_shared_notes_select" on lead_shared_notes;
create policy "lead_shared_notes_select" on lead_shared_notes for select
  to authenticated
  using (
    company_id in (select public.current_member_company_ids())
    and (
      company_id not in (select public.current_lead_scoped_company_ids())
      or lead_id in (select public.current_visible_lead_ids())
    )
  );

-- Staff insert as themselves, into their own company, onto a customer
-- of that company. Client notes arrive through the service role only.
drop policy if exists "lead_shared_notes_insert" on lead_shared_notes;
create policy "lead_shared_notes_insert" on lead_shared_notes for insert
  to authenticated
  with check (
    author_kind = 'staff'
    and author_id = (select auth.uid())
    and (
      company_id in (select public.current_role_company_ids('Office'))
      or company_id in (select public.current_role_company_ids('Sales'))
      or company_id in (select public.current_role_company_ids('Field'))
    )
    and exists (
      select 1 from public.leads l
      where l.id = lead_shared_notes.lead_id
        and l.company_id = lead_shared_notes.company_id
    )
  );

-- Pin, answer, mark seen, and edit one's own text (the trigger narrows
-- the last to the author).
drop policy if exists "lead_shared_notes_update" on lead_shared_notes;
create policy "lead_shared_notes_update" on lead_shared_notes for update
  to authenticated
  using (
    company_id in (select public.current_role_company_ids('Office'))
    or company_id in (select public.current_role_company_ids('Sales'))
    or company_id in (select public.current_role_company_ids('Field'))
  )
  with check (
    company_id in (select public.current_role_company_ids('Office'))
    or company_id in (select public.current_role_company_ids('Sales'))
    or company_id in (select public.current_role_company_ids('Field'))
  );

commit;

-- Verify: RLS on, and exactly three policies (select, insert, update) --
-- no delete.
select relrowsecurity as rls_enabled
from pg_class
where relname = 'lead_shared_notes';

select polname, polcmd
from pg_policy
where polrelid = 'public.lead_shared_notes'::regclass
order by polname;
