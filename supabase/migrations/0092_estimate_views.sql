begin;

-- Every time a customer opens a document in the portal. One row per
-- look; reloads within a few minutes are collapsed by the writer.
-- Staff previews are never recorded -- the point is the customer's
-- attention, not ours.
create table if not exists estimate_views (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  estimate_id uuid not null references estimates(id) on delete cascade,
  viewed_at timestamptz not null default now()
);

create index if not exists estimate_views_by_estimate
  on estimate_views (estimate_id, viewed_at desc);

alter table estimate_views enable row level security;

-- Staff read them like any estimate fact. Writes come only from the
-- portal's server code via the service role, so no insert policy is
-- granted to signed-in users -- a rep must not be able to fabricate
-- customer interest.
create policy "estimate_views_select" on estimate_views for select
  to authenticated using (
    is_member_of_company(company_id)
    and can_view_estimates_in_company(company_id)
  );

commit;
