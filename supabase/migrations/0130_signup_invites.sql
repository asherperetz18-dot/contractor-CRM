-- Self-serve signup: one row per paid-but-not-yet-registered business.
--
-- Until now a new company could only be created from inside the app, by
-- an Office/Admin user who already had one (lib/actions/company.ts). This
-- table is the other door: somebody pays on the public page, Stripe tells
-- us about it, and we park what we know here plus a single-use code that
-- goes out in an email. Opening that link is what actually creates the
-- account and the company.
--
-- Nothing here is readable by the app's normal client -- see the RLS note
-- at the bottom.
begin;

create table signup_invites (
  id uuid primary key default gen_random_uuid(),

  -- Taken from the Stripe Checkout session, so it is the address that
  -- paid. The setup link is only ever sent there.
  email text not null,
  company_name text not null,

  -- Only the hash is stored, exactly as portal_login_tokens does it
  -- (0042). A dump of this table can't be replayed to claim a signup.
  token_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,

  -- Null means the row exists but the email never went out -- the send
  -- failed, or the process died between the insert and Resend answering.
  -- Stripe retries the event, and on the retry a row with no send time is
  -- treated as unsent and gets a freshly minted code, because the raw one
  -- from the first attempt was never kept. Without this column that retry
  -- would see "already provisioned" and quietly send nothing at all.
  invite_sent_at timestamptz,

  -- Unique so a webhook delivered twice cannot provision twice. Stripe
  -- retries on any non-2xx and also fires checkout.session.completed and
  -- checkout.session.async_payment_succeeded for the same session when a
  -- bank debit settles late, so duplicate delivery is normal rather than
  -- exceptional -- the same reasoning as portal_payments (0065).
  stripe_session_id text not null unique,
  stripe_customer_id text,
  stripe_subscription_id text,
  -- The Stripe price the business bought, kept for reference.
  price_id text,

  -- Filled in when the link is redeemed. Null means "paid, not set up
  -- yet", which is exactly the list worth chasing.
  company_id uuid references companies (id) on delete set null,
  profile_id uuid references profiles (id) on delete set null,

  created_at timestamptz not null default now()
);

create index signup_invites_email_idx on signup_invites (email);

-- RLS on with no policies at all: this is reached only through the
-- service-role client, from the Stripe webhook and the registration page.
-- Signed-in staff have no business reading other people's signups, and a
-- visitor holding the link proves their claim by presenting the code
-- rather than by querying the table.
alter table signup_invites enable row level security;

commit;
