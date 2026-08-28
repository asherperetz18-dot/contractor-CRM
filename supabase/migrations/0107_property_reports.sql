begin;

-- One PropertyRadar report per contact: recorded owner, value, equity,
-- loan balance, and the chain of title (deeds, loans, assignments,
-- NODs). Cached because every lookup bills a PropertyRadar credit --
-- reopening an appointment must never quietly spend another one.
create table property_reports (
  lead_id uuid primary key references leads (id) on delete cascade,
  company_id uuid not null references companies (id) on delete cascade,
  -- The address the report was pulled for. A contact whose address has
  -- since changed gets a fresh pull instead of a stale answer.
  address text not null,
  radar_id text,
  owner text,
  ownership_type text,
  owner_occupied boolean,
  avm bigint,
  available_equity bigint,
  equity_percent int,
  total_loan_balance bigint,
  in_foreclosure boolean,
  listed_for_sale boolean,
  transactions jsonb not null default '[]',
  fetched_by uuid references profiles (id) on delete set null,
  fetched_at timestamptz not null default now()
);

create index property_reports_company_idx on property_reports (company_id);

alter table property_reports enable row level security;

create policy "property_reports_select" on property_reports for select
  to authenticated using (is_member_of_company(company_id));
-- Writes go through the service role inside the fetch action, which
-- checks the caller can see the lead first.

commit;
