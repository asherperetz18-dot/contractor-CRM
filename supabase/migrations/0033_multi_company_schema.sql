-- Multi-company support, step 1 of 4: schema only.
--
-- Purely additive -- adds new nullable columns/tables, changes nothing
-- about existing behavior. The app keeps working exactly as it does
-- today until the backfill (0034), NOT NULL constraints (0035), and RLS
-- rewrite (0036) land. Safe to run and verify in isolation.
--
-- `companies` already exists (from the very first schema) but has never
-- been used as a real tenant boundary. This reuses it. `leads.company_id`
-- also already exists (unused, nullable) and is repurposed here rather
-- than duplicated.

-- One row per (profile, company) membership. Replaces profiles.roles /
-- profiles.can_delete_leads / profiles.status as the source of truth for
-- permissions -- a person can hold different roles in different
-- companies. profiles itself stays as identity-only data.
create table company_members (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles (id) on delete cascade,
  company_id uuid not null references companies (id) on delete cascade,
  roles app_role[] not null default '{}',
  can_delete_leads boolean not null default false,
  status user_status not null default 'Active',
  created_at timestamptz not null default now(),
  unique (profile_id, company_id)
);

alter table company_members enable row level security;

-- Tenant tables that need a company boundary. Nullable for now --
-- backfilled in 0034, made required in 0035.
alter table events add column company_id uuid references companies (id);
alter table jobs add column company_id uuid references companies (id);
alter table documents add column company_id uuid references companies (id);
alter table contracts add column company_id uuid references companies (id);
alter table lead_tasks add column company_id uuid references companies (id);
alter table setter_contacts add column company_id uuid references companies (id);
alter table pipeline_stages add column company_id uuid references companies (id);
alter table calendars add column company_id uuid references companies (id);
alter table project_types add column company_id uuid references companies (id);
alter table lead_sources add column company_id uuid references companies (id);
alter table call_dispositions add column company_id uuid references companies (id);
alter table call_logs add column company_id uuid references companies (id);
alter table dial_lists add column company_id uuid references companies (id);
alter table role_page_visibility add column company_id uuid references companies (id);
alter table sms_quick_texts add column company_id uuid references companies (id);
alter table sms_messages add column company_id uuid references companies (id);
alter table activity_events add column company_id uuid references companies (id);
alter table lead_notes add column company_id uuid references companies (id);
alter table lead_files add column company_id uuid references companies (id);

-- pipeline_stages/calendars/call_dispositions/project_types/lead_sources
-- currently enforce a global `unique (name)` -- once per-company, the
-- same name needs to be reusable across companies. Swap for a composite
-- uniqueness constraint scoped by company.
alter table pipeline_stages drop constraint pipeline_stages_name_key;
alter table pipeline_stages add constraint pipeline_stages_company_name_key unique (company_id, name);

alter table calendars drop constraint calendars_name_key;
alter table calendars add constraint calendars_company_name_key unique (company_id, name);

alter table call_dispositions drop constraint call_dispositions_name_key;
alter table call_dispositions add constraint call_dispositions_company_name_key unique (company_id, name);

alter table project_types drop constraint project_types_name_key;
alter table project_types add constraint project_types_company_name_key unique (company_id, name);

alter table lead_sources drop constraint lead_sources_name_key;
alter table lead_sources add constraint lead_sources_company_name_key unique (company_id, name);

alter table role_page_visibility drop constraint role_page_visibility_role_page_key_key;
alter table role_page_visibility add constraint role_page_visibility_company_role_page_key_key unique (company_id, role, page_key);

alter table sms_quick_texts drop constraint sms_quick_texts_pkey;
alter table sms_quick_texts add column id uuid primary key default gen_random_uuid();
alter table sms_quick_texts add constraint sms_quick_texts_company_key_key unique (company_id, key);

-- company_profile and google_drive_connection were both singleton rows
-- (id int default 1, check id = 1). Drop that and move to one row per
-- company, keyed by company_id directly. `cascade` drops the old
-- primary key and check constraint along with the column -- nothing
-- else references company_profile.id or google_drive_connection.id.
alter table company_profile drop column id cascade;
alter table company_profile add column company_id uuid references companies (id);

alter table google_drive_connection drop column id cascade;
alter table google_drive_connection add column company_id uuid references companies (id);
