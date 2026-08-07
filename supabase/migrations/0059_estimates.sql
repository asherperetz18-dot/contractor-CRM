begin;

-- Estimates.
--
-- Deliberately NOT built on the existing `documents` table: that stub
-- hangs off job_id (jobs is empty and unused) and contact_id (there is no
-- contacts table at all -- the Contacts page reads leads). It is abandoned
-- first-draft scaffolding, same as the unused company_id columns found
-- during the multi-company work, and reusing it would mean inventing a
-- phantom job row for every estimate. Estimates hang off the lead, which
-- is what everything else in this CRM hangs off.

create type estimate_status as enum (
  'Draft',     -- being written, customer has never seen it
  'Sent',      -- delivered to the customer, awaiting a response
  'Viewed',    -- customer opened the portal link
  'Signed',    -- all signers have signed; this is a contract
  'Declined',  -- customer said no
  'Expired'    -- passed expires_at without a response
);

-- Money is stored in integer cents everywhere below. Quantity x unit price
-- x tax in floating point drifts by a cent or two, and a $0.01 mismatch on
-- a document a homeowner is about to sign is the kind of error that costs
-- a sale. Tax rates are basis points for the same reason (950 = 9.50%).

create table estimates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,

  doc_number text not null,
  title text not null default '',
  status estimate_status not null default 'Draft',

  -- A sent estimate is never edited in place -- editing one supersedes it
  -- with a new version and leaves the original readable. Contractors get
  -- into "that is not what you quoted me" disputes, and history you did
  -- not keep cannot be reconstructed later.
  version int not null default 1,
  supersedes_id uuid references estimates(id) on delete set null,

  assigned_to uuid references profiles(id) on delete set null,

  issued_at timestamptz,
  expires_at date,

  -- Snapshot, not a live join: the company tax rate changing next year
  -- must not silently rewrite the total on a document already signed.
  tax_rate_bp int not null default 0,
  subtotal_cents bigint not null default 0,
  tax_cents bigint not null default 0,
  total_cents bigint not null default 0,
  deposit_cents bigint,

  customer_message text,
  terms text,
  notes text,                       -- internal; never shown to the customer

  sent_at timestamptz,
  viewed_at timestamptz,
  signed_at timestamptz,
  declined_at timestamptz,
  declined_reason text,

  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint estimates_doc_number_unique unique (company_id, doc_number),
  constraint estimates_totals_nonneg check (
    subtotal_cents >= 0 and tax_cents >= 0 and total_cents >= 0
  )
);

create index estimates_company_status_idx on estimates (company_id, status, created_at desc);
create index estimates_lead_idx on estimates (lead_id, created_at desc);
create index estimates_assigned_idx on estimates (assigned_to, created_at desc);

-- Line items as real rows rather than the stub's jsonb blob: "which items
-- do we sell most", "what do we average on a bathroom", and any margin
-- reporting are all ordinary queries this way and painful against jsonb.
create table estimate_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  estimate_id uuid not null references estimates(id) on delete cascade,

  sort_order int not null default 0,
  name text not null default '',
  description text,

  quantity numeric(12,2) not null default 1,
  unit text,                        -- ea, sq ft, lf, hr...
  unit_price_cents bigint not null default 0,
  line_total_cents bigint not null default 0,

  -- Per-line rather than one rate on the whole document: in California
  -- labor is generally not taxed while materials are, so a flat rate over
  -- the subtotal over-charges tax on any labor-heavy job.
  taxable boolean not null default false,

  -- Internal only. Never rendered on the customer-facing document.
  cost_cents bigint,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index estimate_items_estimate_idx on estimate_items (estimate_id, sort_order);

-- Signers, plural and per-row. The reference product tracks documents as
-- "1 of 2 signed" naming exactly who is still pending, because the
-- contractor signs too and co-owning homeowners both have to. A single
-- signed_at/signature_name pair on the estimate cannot express that.
create table estimate_signers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  estimate_id uuid not null references estimates(id) on delete cascade,

  party text not null check (party in ('company', 'customer')),
  name text not null,
  email text,
  phone text,
  sort_order int not null default 0,

  signed_at timestamptz,
  signature_name text,              -- what they actually typed
  signature_ip text,
  signature_user_agent text,

  created_at timestamptz not null default now()
);

create index estimate_signers_estimate_idx on estimate_signers (estimate_id, sort_order);

-- Company-level estimate settings.
alter table company_profile
  add column if not exists tax_rate_bp int not null default 0,
  add column if not exists estimate_seq int not null default 1000,
  add column if not exists estimate_expiry_days int not null default 7,
  add column if not exists estimate_terms text;

-- Sequential per-company document numbers (EST-1001, EST-1002...).
-- Done in the database so two reps creating an estimate at the same moment
-- cannot be handed the same number.
create or replace function next_estimate_number(check_company_id uuid)
returns text as $$
  update public.company_profile
     set estimate_seq = estimate_seq + 1
   where company_id = check_company_id
  returning 'EST-' || estimate_seq;
$$ language sql volatile security definer set search_path = public;

-- Sales-only users see an estimate exactly when they can see its lead,
-- reusing the same rule the rest of the app is scoped by.
create or replace function estimate_visible_to_current_user(check_estimate_id uuid)
returns boolean as $$
  select exists (
    select 1 from public.estimates e
    where e.id = check_estimate_id
      and (not is_sales_only(e.company_id) or lead_visible_to_current_user(e.lead_id))
  );
$$ language sql stable security definer set search_path = public;

alter table estimates enable row level security;
alter table estimate_items enable row level security;
alter table estimate_signers enable row level security;

-- ── estimates ────────────────────────────────────────────────────────
create policy "estimates_select" on estimates for select
  to authenticated using (
    is_member_of_company(company_id)
    and (not is_sales_only(company_id) or lead_visible_to_current_user(lead_id))
  );

create policy "estimates_insert" on estimates for insert
  to authenticated with check (
    has_role_in_company('Office', company_id)
    or has_role_in_company('Sales', company_id)
    or has_role_in_company('Admin', company_id)
  );

create policy "estimates_update" on estimates for update
  to authenticated using (
    (has_role_in_company('Office', company_id)
     or has_role_in_company('Sales', company_id)
     or has_role_in_company('Admin', company_id))
    and (not is_sales_only(company_id) or lead_visible_to_current_user(lead_id))
  );

-- Deleting priced work a customer may have already seen is an office
-- decision, matching how lead deletion is already gated.
create policy "estimates_delete" on estimates for delete
  to authenticated using (
    has_role_in_company('Office', company_id) or has_role_in_company('Admin', company_id)
  );

-- ── estimate_items ───────────────────────────────────────────────────
create policy "estimate_items_select" on estimate_items for select
  to authenticated using (
    is_member_of_company(company_id) and estimate_visible_to_current_user(estimate_id)
  );

create policy "estimate_items_write" on estimate_items for all
  to authenticated using (
    is_member_of_company(company_id)
    and estimate_visible_to_current_user(estimate_id)
    and (has_role_in_company('Office', company_id)
         or has_role_in_company('Sales', company_id)
         or has_role_in_company('Admin', company_id))
  )
  with check (
    is_member_of_company(company_id)
    and (has_role_in_company('Office', company_id)
         or has_role_in_company('Sales', company_id)
         or has_role_in_company('Admin', company_id))
  );

-- ── estimate_signers ─────────────────────────────────────────────────
create policy "estimate_signers_select" on estimate_signers for select
  to authenticated using (
    is_member_of_company(company_id) and estimate_visible_to_current_user(estimate_id)
  );

create policy "estimate_signers_write" on estimate_signers for all
  to authenticated using (
    is_member_of_company(company_id)
    and estimate_visible_to_current_user(estimate_id)
    and (has_role_in_company('Office', company_id)
         or has_role_in_company('Sales', company_id)
         or has_role_in_company('Admin', company_id))
  )
  with check (
    is_member_of_company(company_id)
    and (has_role_in_company('Office', company_id)
         or has_role_in_company('Sales', company_id)
         or has_role_in_company('Admin', company_id))
  );

-- The customer signs from the portal, which is not an authenticated
-- Supabase user -- that path goes through the service role in a server
-- action that has already validated the portal session, so it needs no
-- policy here.

commit;
