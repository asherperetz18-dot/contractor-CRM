-- 0179: "Send without approval" -- a per-person switch on Users & Roles.
--
-- With estimate approval switched on (0136), nothing leaves Draft until
-- an Admin approves it. That is right for most of the team, and wrong for
-- a closer the owner trusts to price a job at the kitchen table: the
-- customer is ready, and the document waits on someone who isn't there.
--
-- So: a flag per member, the same shape as can_send_estimates (0126).
-- When a person holding it sends, the send records the approval in THEIR
-- name (approved_at / approved_by) and notes it on the contact. The gate
-- still fires for everyone else, and the record still says who let each
-- document go out -- the switch skips the wait, not the paper trail.
--
-- Defaults to FALSE: an ability nobody had yesterday, granted to the
-- specific people who should have it.
--
-- ── Admin only, in the database ─────────────────────────────────────
--
-- Office users can edit company_members (they run Users & Roles), so
-- RLS alone would let Office switch this on for themselves and walk
-- around the approval gate -- which exists to check Office's sends too.
-- The trigger below refuses any change to the flag from a signed-in
-- user who is not an Admin of that company (or a super admin). The
-- service role (auth.uid() null) is not a signed-in user and passes.
--
-- The 0136 trigger needs no change: it lets a document out of Draft
-- whenever approved_at is set, and the app sets it just before a
-- trusted person's send.
--
-- Idempotent; safe as one paste in the Supabase SQL editor, safe to run
-- twice. The select at the end says what landed.

alter table public.company_members
  add column if not exists can_send_without_approval boolean not null default false;

comment on column public.company_members.can_send_without_approval is
  'Users & Roles > Send Without Approval. On = this person''s sends approve themselves (recorded in their name) while estimate approval is required. Admin-only to change.';

create or replace function public.guard_send_without_approval()
returns trigger as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'UPDATE'
     and new.can_send_without_approval is not distinct from old.can_send_without_approval then
    return new;
  end if;
  if tg_op = 'INSERT' and new.can_send_without_approval = false then
    return new;
  end if;
  if public.has_role_in_company('Admin'::app_role, new.company_id) then return new; end if;
  if exists (select 1 from public.profiles where id = auth.uid() and is_super_admin = true) then
    return new;
  end if;
  raise exception 'Only an Admin can change who sends without approval.'
    using errcode = 'insufficient_privilege';
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists company_members_guard_send_without_approval on public.company_members;
create trigger company_members_guard_send_without_approval
  before insert or update on public.company_members
  for each row execute function public.guard_send_without_approval();

select
  (select count(*) from information_schema.columns
    where table_name = 'company_members' and column_name = 'can_send_without_approval') as column_added,
  (select count(*) from pg_trigger
    where tgname = 'company_members_guard_send_without_approval') as guard_added,
  (select count(*) from company_members where can_send_without_approval) as members_who_skip_approval;
