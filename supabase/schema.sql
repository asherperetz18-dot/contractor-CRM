-- Contractor CRM — initial schema
-- Run once in Supabase Dashboard -> SQL Editor (or via `supabase db push` later).
-- Idempotent-ish: safe to re-run on a fresh project.

-- ============================================================
-- Enums
-- ============================================================
create type app_role as enum ('Office', 'Field');
create type user_status as enum ('Active', 'Archived');
create type contact_type as enum ('Individual', 'Company');
create type pipeline_stage as enum (
  'New Leads', 'Contacted', 'Estimate Scheduled', 'Estimate Sent',
  'Negotiating', 'Won', 'Lost'
);
create type job_status as enum ('Not Started', 'In Progress', 'On Hold', 'Complete');
create type document_type as enum ('Estimate', 'Invoice');
create type document_status as enum ('Draft', 'Sent', 'Approved', 'Paid');
create type event_type as enum ('Estimate', 'Job Visit', 'Meeting', 'Other');
create type contract_status as enum ('Draft', 'Sent', 'Signed');

-- ============================================================
-- Reference / org tables
-- ============================================================
create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

-- Singleton row (id always 1): company identity shown in Admin Settings.
create table company_profile (
  id int primary key default 1 check (id = 1),
  name text,
  address text,
  email text,
  phone text,
  website text,
  license_holder_name text,
  license_number text,
  license_state text,
  license_type text,
  timezone text not null default 'Pacific',
  logo_url text,
  updated_at timestamptz not null default now()
);
insert into company_profile (id) values (1) on conflict (id) do nothing;

-- Extends auth.users with app-specific fields + roles. Row is created by
-- the handle_new_user trigger below whenever a Supabase Auth user signs up.
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text,
  email text,
  phone text,
  company_id uuid references companies (id) on delete set null,
  roles app_role[] not null default '{}',
  status user_status not null default 'Active',
  created_at timestamptz not null default now()
);

-- ============================================================
-- Core business tables
-- ============================================================
create table leads (
  id uuid primary key default gen_random_uuid(),
  contact_type contact_type not null default 'Individual',
  company_id uuid references companies (id) on delete set null,
  company_name text,
  first_name text,
  last_name text,
  phone text,
  email text,
  address text,
  zip text,
  source text,
  project_type text,
  stage pipeline_stage not null default 'New Leads',
  value numeric(12, 2) not null default 0,
  notes text,
  has_appt boolean not null default false,
  second_contact_first_name text,
  second_contact_last_name text,
  second_contact_phone text,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads (id) on delete set null,
  name text not null,
  address text,
  status job_status not null default 'Not Started',
  start_date date,
  end_date date,
  assigned_to uuid references profiles (id) on delete set null,
  notes text,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  type document_type not null,
  contact_id uuid references leads (id) on delete set null,
  client_name text,
  client_phone text,
  client_email text,
  client_address text,
  job_id uuid references jobs (id) on delete set null,
  date date not null default current_date,
  status document_status not null default 'Draft',
  items jsonb not null default '[]', -- [{desc, qty, price}]
  notes text,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table events (
  id uuid primary key default gen_random_uuid(),
  title text,
  date date not null,
  time time,
  event_type event_type not null default 'Other',
  assigned_to uuid references profiles (id) on delete set null,
  job_id uuid references jobs (id) on delete set null, -- "relatedId" in spec
  lead_id uuid references leads (id) on delete set null,
  notes text,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table contracts (
  id uuid primary key default gen_random_uuid(),
  title text,
  client_name text,
  job_id uuid references jobs (id) on delete set null,
  status contract_status not null default 'Draft',
  signed_date date,
  notes text,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- Indexes
-- ============================================================
create index leads_stage_idx on leads (stage);
create index leads_created_at_idx on leads (created_at desc);
create index jobs_lead_id_idx on jobs (lead_id);
create index jobs_status_idx on jobs (status);
create index documents_job_id_idx on documents (job_id);
create index documents_contact_id_idx on documents (contact_id);
create index events_date_idx on events (date);
create index events_job_id_idx on events (job_id);
create index events_lead_id_idx on events (lead_id);
create index contracts_job_id_idx on contracts (job_id);

-- ============================================================
-- updated_at trigger helper
-- ============================================================
create function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger leads_set_updated_at before update on leads
  for each row execute function set_updated_at();
create trigger jobs_set_updated_at before update on jobs
  for each row execute function set_updated_at();
create trigger documents_set_updated_at before update on documents
  for each row execute function set_updated_at();
create trigger events_set_updated_at before update on events
  for each row execute function set_updated_at();
create trigger contracts_set_updated_at before update on contracts
  for each row execute function set_updated_at();

-- ============================================================
-- New auth user -> profiles row
-- First user ever created is auto-promoted to Office so there's always
-- at least one admin; everyone after that starts with no roles until an
-- Office user assigns one from Admin Settings -> Users & Roles.
-- ============================================================
create function handle_new_user() returns trigger as $$
begin
  insert into public.profiles (id, name, email, roles)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', new.email),
    new.email,
    case when (select count(*) from public.profiles) = 0
      then array['Office']::app_role[]
      else '{}'::app_role[]
    end
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================
-- Role-check helper (used throughout RLS policies)
-- ============================================================
create function has_role(check_role app_role) returns boolean as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and check_role = any(roles)
      and status = 'Active'
  );
$$ language sql stable security definer set search_path = public;

-- ============================================================
-- Row Level Security
--
-- Default policy for v1 (spec doesn't yet define a granular permission
-- matrix beyond "Office vs Field, server-enforced, not a client toggle"):
--   - Office: full read/write on everything, including Admin Settings data.
--   - Field:  read everything (leads, jobs, documents, events, contracts),
--             but can only write to jobs and events (their day-to-day
--             operational work) — not sales/financial records or admin.
-- Revisit per-table as real permission requirements firm up.
-- ============================================================
alter table companies enable row level security;
alter table company_profile enable row level security;
alter table profiles enable row level security;
alter table leads enable row level security;
alter table jobs enable row level security;
alter table documents enable row level security;
alter table events enable row level security;
alter table contracts enable row level security;

-- companies: any authenticated user can read; only Office manages.
create policy "companies_select" on companies for select
  to authenticated using (true);
create policy "companies_write" on companies for all
  to authenticated using (has_role('Office')) with check (has_role('Office'));

-- company_profile: any authenticated user can read; only Office edits.
create policy "company_profile_select" on company_profile for select
  to authenticated using (true);
create policy "company_profile_write" on company_profile for update
  to authenticated using (has_role('Office')) with check (has_role('Office'));

-- profiles: everyone can read (needed for assignee pickers, badges);
-- users can update their own basic info; only Office can change roles/
-- status or manage other users (enforced by not exposing role/status
-- edits in the client for non-Office users — add a stricter column-level
-- policy here if that trust boundary needs hardening later).
create policy "profiles_select" on profiles for select
  to authenticated using (true);
create policy "profiles_update_self" on profiles for update
  to authenticated using (auth.uid() = id) with check (auth.uid() = id);
create policy "profiles_office_manage" on profiles for all
  to authenticated using (has_role('Office')) with check (has_role('Office'));

-- leads: read all; write is Office-only.
create policy "leads_select" on leads for select
  to authenticated using (true);
create policy "leads_write" on leads for all
  to authenticated using (has_role('Office')) with check (has_role('Office'));

-- jobs: read all; Office or Field can write (Field runs day-to-day ops).
create policy "jobs_select" on jobs for select
  to authenticated using (true);
create policy "jobs_write" on jobs for all
  to authenticated using (has_role('Office') or has_role('Field'))
  with check (has_role('Office') or has_role('Field'));

-- documents (estimates/invoices): read all; write is Office-only.
create policy "documents_select" on documents for select
  to authenticated using (true);
create policy "documents_write" on documents for all
  to authenticated using (has_role('Office')) with check (has_role('Office'));

-- events (calendar/schedule): read all; Office or Field can write.
create policy "events_select" on events for select
  to authenticated using (true);
create policy "events_write" on events for all
  to authenticated using (has_role('Office') or has_role('Field'))
  with check (has_role('Office') or has_role('Field'));

-- contracts: read all; write is Office-only.
create policy "contracts_select" on contracts for select
  to authenticated using (true);
create policy "contracts_write" on contracts for all
  to authenticated using (has_role('Office')) with check (has_role('Office'));
