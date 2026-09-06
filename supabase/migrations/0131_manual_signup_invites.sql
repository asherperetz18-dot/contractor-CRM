-- Lets an Office/Admin user invite a business directly, without a Stripe
-- payment -- for a VIP contractor, a trial, or anyone the team wants in
-- the door without collecting a card first.
--
-- Every signup_invites row so far came from a paid Checkout session, so
-- company_name and stripe_session_id were both guaranteed to exist by
-- the time a row did (0130). A manually-sent invite has neither: nobody
-- has typed a company name yet, and there is no checkout to attach to.
-- Both become optional here; the register page asks for a company name
-- itself when the invite didn't already carry one (completeSignup in
-- lib/actions/signup.ts), and the manual path never sets
-- stripe_session_id at all.
begin;

alter table signup_invites
  alter column company_name drop not null,
  alter column stripe_session_id drop not null;

-- Multiple NULLs are fine under the existing unique constraint on
-- stripe_session_id -- Postgres does not treat NULL as equal to NULL, so
-- any number of manual invites can coexist with it left unset.

-- Which door an invite came in. Nothing branches on this yet; it exists
-- so a support question ("who sent this?") has an answer without having
-- to infer it from which columns happen to be null.
alter table signup_invites
  add column if not exists source text not null default 'stripe' check (source in ('stripe', 'manual'));

commit;
