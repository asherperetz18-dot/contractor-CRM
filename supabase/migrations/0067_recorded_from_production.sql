-- Objects the live database has that no file in this folder created
-- (DECISIONS #115).
--
-- Each was added by hand in the Supabase dashboard at some point and
-- never written down, so a database built from these files alone came
-- out different from production, and several later migrations (0069,
-- 0088, 0095, 0117, 0191) failed on it. The definitions below were read
-- from production on 2026-10-05 (supabase/checks/schema-drift-check.sql)
-- and are copied exactly.
--
-- Numbered 0067 -- a free slot after 0036 and before the first file that
-- relies on any of these -- so a fresh database built from the files in
-- order matches production.
--
-- Already in production: running this there changes nothing. Every
-- statement is guarded.

-- ── leads.dispatcher_id ──────────────────────────────────────────────
-- The dispatcher a lead belongs to (0069 onwards scopes on it).
alter table public.leads
  add column if not exists dispatcher_id uuid references public.profiles (id);
create index if not exists leads_dispatcher_idx
  on public.leads (dispatcher_id) where dispatcher_id is not null;

-- dispatcher_may_touch_lead(): used by the events policies from 0117.
do $do$
begin
  if to_regprocedure('public.dispatcher_may_touch_lead(uuid)') is null then
    create function public.dispatcher_may_touch_lead(check_lead_id uuid)
    returns boolean
    language sql
    stable security definer
    set search_path to 'public'
    as $fn$
  select check_lead_id is null or exists (
    select 1 from public.leads
    where id = check_lead_id
      and (dispatcher_id = auth.uid() or dispatcher_id is null)
  );
$fn$;
  end if;
end
$do$;

-- ── events: events_write split by command ────────────────────────────
-- 0084 already noted it: "events_write had been split by hand into
-- events_insert, events_update, events_select and events_delete, which
-- is not recorded anywhere here". This is that split, with the rule
-- events_write held (0036). 0088 and 0117 then narrow each one to what
-- production has today.
do $do$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'events' and policyname = 'events_write'
  ) then
    create policy "events_insert" on public.events for insert
      to authenticated with check (
        has_role_in_company('Office', company_id) or has_role_in_company('Field', company_id)
        or (has_role_in_company('Sales', company_id) and (not is_sales_only(company_id) or assigned_to = auth.uid()))
      );
    create policy "events_update" on public.events for update
      to authenticated using (
        has_role_in_company('Office', company_id) or has_role_in_company('Field', company_id)
        or (has_role_in_company('Sales', company_id) and (not is_sales_only(company_id) or assigned_to = auth.uid()))
      )
      with check (
        has_role_in_company('Office', company_id) or has_role_in_company('Field', company_id)
        or (has_role_in_company('Sales', company_id) and (not is_sales_only(company_id) or assigned_to = auth.uid()))
      );
    create policy "events_delete" on public.events for delete
      to authenticated using (
        has_role_in_company('Office', company_id) or has_role_in_company('Field', company_id)
        or (has_role_in_company('Sales', company_id) and (not is_sales_only(company_id) or assigned_to = auth.uid()))
      );
    drop policy "events_write" on public.events;
  end if;
end
$do$;

-- ── company_profile: each company's own Twilio and Stripe ────────────
-- The phone number (0095 onwards), the Twilio account and in-app calling
-- (DECISIONS #104), and the company's own Stripe keys. Secrets are only
-- ever stored encrypted (*_enc, APP_ENCRYPTION_KEY).
alter table public.company_profile
  add column if not exists twilio_phone_number text,
  add column if not exists twilio_account_sid text,
  add column if not exists twilio_auth_token_enc text,
  add column if not exists twilio_api_key_sid text,
  add column if not exists twilio_api_key_secret_enc text,
  add column if not exists twilio_twiml_app_sid text,
  add column if not exists twilio_connected_at timestamptz,
  add column if not exists stripe_secret_key_enc text,
  add column if not exists stripe_webhook_secret_enc text,
  add column if not exists stripe_key_mode text
    check ((stripe_key_mode is null) or (stripe_key_mode = any (array['test'::text, 'live'::text]))),
  add column if not exists stripe_key_last4 text,
  add column if not exists stripe_connected_at timestamptz,
  add column if not exists dispatcher_commission_bp integer not null default 100;

-- One company per Twilio number: inbound calls and texts are routed by it.
create unique index if not exists company_profile_twilio_number_idx
  on public.company_profile (twilio_phone_number) where twilio_phone_number is not null;

-- ── lead_files.event_id ──────────────────────────────────────────────
-- A photo or file taken on a visit, tied to that appointment.
alter table public.lead_files
  add column if not exists event_id uuid references public.events (id) on delete set null;
create index if not exists lead_files_event_idx
  on public.lead_files (event_id) where event_id is not null;

-- ── storage: the logos bucket ────────────────────────────────────────
-- Public on purpose: the portal shows the logo before the customer has
-- signed in (the only bucket left public, DECISIONS #108).
insert into storage.buckets (id, name, public)
values ('logos', 'logos', true)
on conflict (id) do nothing;
