-- Platform access record (DECISIONS #128).
--
-- Platform admins hold a seat in every company so they can open it
-- (0132, granted_via_platform_admin). From now on, each time one of those
-- seats is used to open a company, who did it and when is written here.
-- Opening a company the admin genuinely belongs to is not recorded.
--
-- Append-only: rows can be added, never edited, and never removed on
-- their own -- only together with their company. Only the server
-- (service role) reads or writes it, behind the Platform Admin page; with
-- row-level security on and no policies, nobody signed in to the app can.
--
-- Until this runs, opening a company works as before, unrecorded.
-- Safe to run twice.

begin;

create table if not exists public.platform_access_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  -- No foreign key on purpose: removing the person must not touch the
  -- record, which keeps their name and email as they were.
  profile_id uuid,
  actor_name text,
  actor_email text,
  opened_at timestamptz not null default now()
);

create index if not exists platform_access_log_company_idx
  on public.platform_access_log (company_id, opened_at desc);
create index if not exists platform_access_log_opened_idx
  on public.platform_access_log (opened_at desc);

alter table public.platform_access_log enable row level security;

create or replace function public.platform_access_log_append_only()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  -- A row goes only when its company does: the company's delete reaches
  -- this table through its foreign key, one trigger level down.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'platform_access_log is append-only';
end
$$;

drop trigger if exists platform_access_log_append_only on public.platform_access_log;
create trigger platform_access_log_append_only
  before update or delete on public.platform_access_log
  for each row execute function public.platform_access_log_append_only();

drop trigger if exists platform_access_log_no_truncate on public.platform_access_log;
create trigger platform_access_log_no_truncate
  before truncate on public.platform_access_log
  for each statement execute function public.platform_access_log_append_only();

-- Every company table carries the subscription lock (0175).
select public.apply_billing_lock_policies();

commit;

-- Check: should read true.
select exists (
  select 1 from information_schema.tables
  where table_schema = 'public' and table_name = 'platform_access_log'
) as platform_access_log_ready;
