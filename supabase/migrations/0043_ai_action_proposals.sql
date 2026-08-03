-- AI proposals: the assistant can suggest changes to CRM data, but never
-- applies them itself. Each suggestion lands here as a pending row that a
-- human explicitly approves or dismisses, and the row doubles as the audit
-- trail of what the AI proposed, who decided, and what actually happened.

begin;

create table ai_action_proposals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id),
  proposed_by uuid references profiles (id) on delete set null,
  -- Whitelisted on the server (see lib/actions/ai-actions.ts). Anything
  -- not in that whitelist is refused at apply time regardless of what is
  -- stored here.
  action_type text not null,
  params jsonb not null,
  summary text not null,
  target_count integer not null default 0,
  status text not null default 'pending',
  decided_by uuid references profiles (id) on delete set null,
  decided_at timestamptz,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  constraint ai_action_proposals_status_check
    check (status in ('pending', 'applied', 'rejected', 'failed'))
);

create index ai_action_proposals_company_idx
  on ai_action_proposals (company_id, created_at desc);

alter table ai_action_proposals enable row level security;

-- Everyone in the company can see what the AI proposed and what was done
-- with it, so the audit trail isn't admin-only.
create policy "ai_action_proposals_select" on ai_action_proposals for select
  to authenticated using (
    exists (
      select 1 from company_members cm
      where cm.profile_id = auth.uid()
        and cm.company_id = ai_action_proposals.company_id
        and cm.status = 'Active'
    )
  );

-- Only Office/Admin can create or decide on proposals -- these change real
-- customer records in bulk.
create policy "ai_action_proposals_insert" on ai_action_proposals for insert
  to authenticated with check (
    has_role_in_company('Office', company_id) or has_role_in_company('Admin', company_id)
  );

create policy "ai_action_proposals_update" on ai_action_proposals for update
  to authenticated using (
    has_role_in_company('Office', company_id) or has_role_in_company('Admin', company_id)
  ) with check (
    has_role_in_company('Office', company_id) or has_role_in_company('Admin', company_id)
  );

commit;
