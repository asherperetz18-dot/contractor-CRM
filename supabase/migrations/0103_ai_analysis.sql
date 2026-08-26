begin;

-- Company-level switches for the conversation analyzer, mirroring the
-- AI Estimator's settings shape. The signal lists are the company's own
-- sales language; blank means the built-in defaults apply.
alter table company_profile add column ai_analysis_enabled boolean not null default false;
alter table company_profile add column ai_analysis_model text not null default 'claude-opus-5';
alter table company_profile add column ai_analysis_positive_signals text;
alter table company_profile add column ai_analysis_negative_signals text;

-- One current analysis per contact, overwritten on re-analyze. History
-- isn't kept: the conversation itself is the record, and an analysis is
-- a reading of it, not a fact of its own.
create table lead_ai_analysis (
  lead_id uuid primary key references leads (id) on delete cascade,
  company_id uuid not null references companies (id) on delete cascade,
  temperature text not null,
  summary text not null,
  positive_signals jsonb not null default '[]',
  negative_signals jsonb not null default '[]',
  next_step text,
  -- What the analysis had to read, so the UI can say "12 texts, 3 calls
  -- as of Tuesday" and staff can tell a fresh reading from a stale one.
  source_counts jsonb,
  analyzed_by uuid references profiles (id) on delete set null,
  analyzed_at timestamptz not null default now()
);

create index lead_ai_analysis_company_idx on lead_ai_analysis (company_id);

alter table lead_ai_analysis enable row level security;

-- Anyone who can open the contact can read its analysis; writes happen
-- through the service role inside the analyze action, which checks the
-- caller can see the lead first.
create policy "lead_ai_analysis_select" on lead_ai_analysis for select
  to authenticated using (is_member_of_company(company_id));

commit;
