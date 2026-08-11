-- Licence and insurance certificates.
--
-- These are the documents a homeowner is entitled to ask for before
-- letting anyone start work, and the ones a contractor is forever
-- re-sending by text. Kept on the company rather than on a lead, because
-- they are the same document for every customer.
--
-- Run each step on its own. No begin/commit -- a failure inside a
-- transaction rolls the whole block back and the editor reports nothing.

-- ---------------------------------------------------------------- step 1
create table if not exists company_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  -- What it is, so the portal can group and label without guessing from
  -- the file name.
  kind text not null default 'license',
  title text not null,
  file_name text not null,
  file_path text not null,
  file_url text not null,
  content_type text,
  file_size bigint,
  -- Insurance lapses. An expired certificate shown to a customer is worse
  -- than none at all, so the date is stored rather than living in
  -- somebody's memory, and the portal stops showing it once it passes.
  expires_on date,
  show_on_portal boolean not null default true,
  uploaded_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- step 2
create index if not exists company_documents_company_idx
  on company_documents (company_id, kind);

alter table company_documents enable row level security;

-- ---------------------------------------------------------------- step 3
-- Readable by the company's own staff. The portal does not read through
-- RLS -- a customer has no Supabase session -- it is served by the
-- service role after the portal token has established who they are.
drop policy if exists "company_documents_select" on company_documents;
create policy "company_documents_select" on company_documents for select
  to authenticated using (
    exists (
      select 1 from company_members m
      where m.profile_id = auth.uid()
        and m.company_id = company_documents.company_id
        and m.status = 'Active'
    )
  );

drop policy if exists "company_documents_write" on company_documents;
create policy "company_documents_write" on company_documents for all
  to authenticated
  using (has_role_in_company('Office', company_id))
  with check (has_role_in_company('Office', company_id));

-- ---------------------------------------------------------------- step 4
-- The bucket the files themselves live in. Public, like lead-files: these
-- are documents whose whole purpose is being handed to customers, and the
-- portal has to render them without a Supabase session.
insert into storage.buckets (id, name, public)
values ('company-docs', 'company-docs', true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------- step 5
-- Proof rather than a success message.
select
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'company_documents') as policies,
  (select count(*) from storage.buckets where id = 'company-docs')  as bucket;
