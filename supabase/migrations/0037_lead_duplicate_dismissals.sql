-- Tracks pairs of leads a user has explicitly marked "not a duplicate",
-- so the duplicate-detection tool doesn't keep re-surfacing the same
-- pair on every scan. Detection itself is computed on demand from
-- leads (matching phone/email) rather than stored -- this table only
-- remembers dismissals.
begin;

create table lead_duplicate_dismissals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  lead_id_a uuid not null references leads (id) on delete cascade,
  lead_id_b uuid not null references leads (id) on delete cascade,
  dismissed_by uuid references profiles (id) on delete set null,
  dismissed_at timestamptz not null default now(),
  -- App code always inserts with lead_id_a < lead_id_b so a pair can't
  -- be dismissed twice under swapped ordering.
  constraint lead_duplicate_dismissals_ordered check (lead_id_a < lead_id_b),
  unique (lead_id_a, lead_id_b)
);

alter table lead_duplicate_dismissals enable row level security;

create policy "lead_duplicate_dismissals_select" on lead_duplicate_dismissals for select
  to authenticated using (is_member_of_company(company_id));

create policy "lead_duplicate_dismissals_insert" on lead_duplicate_dismissals for insert
  to authenticated with check (
    has_role_in_company('Office', company_id) or has_role_in_company('Sales', company_id)
  );

commit;
