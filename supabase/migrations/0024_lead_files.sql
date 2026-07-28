-- File attachments per lead/contact, matching the real product's Files
-- tab. Kept as a flat list for now -- folder/subtype categorization and
-- per-audience visibility is the separate, not-yet-built "Document
-- Folders" admin setting.
create table lead_files (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads (id) on delete cascade,
  uploaded_by uuid references profiles (id) on delete set null,
  file_name text not null,
  file_path text not null,
  file_url text not null,
  file_size bigint,
  content_type text,
  created_at timestamptz not null default now()
);

create index lead_files_lead_id_idx on lead_files (lead_id);

alter table lead_files enable row level security;

create policy "lead_files_select" on lead_files for select
  to authenticated using (true);
create policy "lead_files_insert" on lead_files for insert
  to authenticated with check (has_role('Office') or has_role('Sales') or has_role('Field'));
create policy "lead_files_delete" on lead_files for delete
  to authenticated using (has_role('Office') or has_role('Admin'));

insert into storage.buckets (id, name, public)
values ('lead-files', 'lead-files', true)
on conflict (id) do nothing;
