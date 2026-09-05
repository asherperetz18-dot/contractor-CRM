import "server-only";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripeEnv, stripeClient, type StripeEnv } from "@/lib/stripe-env";
import { sendEmail, escapeHtml } from "@/lib/email-env";
import {
  DEFAULT_CALENDARS,
  DEFAULT_CALL_DISPOSITIONS,
  DEFAULT_LEAD_SOURCES,
  DEFAULT_PIPELINE_STAGES,
  DEFAULT_PROJECT_TYPES,
} from "@/lib/data/company-defaults";
import {
  createInvite,
  INVITE_TTL_DAYS,
  markInviteSent,
  registerUrl,
  sentInviteForSession,
} from "@/lib/signup/invites";

/**
 * Everything the public signup needs in order to sell anything: a Stripe
 * account to charge on, and a plan to charge for.
 *
 * One predicate rather than two. The page and the server action both have
 * to answer "is self-serve signup switched on", and when they answered it
 * separately the page could render a working button whose action refused.
 *
 * The price lives in an env var so the plan can change, or a second one
 * be introduced, without a code change -- and so a deployment that has
 * not set it simply has no public signup rather than a broken one.
 */
export function signupConfig(): { env: StripeEnv; priceId: string } | null {
  const env = getStripeEnv();
  const priceId = process.env.SIGNUP_PRICE_ID?.trim();
  return env && priceId ? { env, priceId } : null;
}

export function signupConfigured(): boolean {
  return signupConfig() !== null;
}

/**
 * `companies.name` is unique across the whole system, which was fine when
 * only an admin could add one and could see the clash coming. A stranger
 * paying on the public page cannot, and two real businesses are allowed
 * to share a name -- so the second one gets a suffix rather than a failed
 * signup after their card was charged. They can rename it in Settings.
 *
 * The common case costs one insert. Only a genuine clash pays for the
 * lookup, and that lookup reads every taken suffix at once: probing them
 * one insert at a time meant a popular trade name cost a round trip per
 * attempt while the customer watched a spinner.
 */
async function insertCompanyWithUniqueName(
  name: string,
  onClash: "suffix" | "fail"
): Promise<{ id?: string; error?: string }> {
  const admin = createAdminClient();

  const attempt = async (candidate: string) =>
    admin.from("companies").insert({ name: candidate }).select("id").single();

  const isTaken = (error: { code?: string } | null) => error?.code === "23505";

  const first = await attempt(name);
  if (!first.error && first.data) return { id: (first.data as { id: string }).id };
  if (!isTaken(first.error)) {
    return { error: first.error?.message ?? "Could not create the company." };
  }

  // An admin typing a name into Settings can see the clash and fix it, so
  // they get told. A stranger whose card has just been charged cannot, so
  // they get a suffix -- a slightly odd name beats a failed signup.
  if (onClash === "fail") {
    return { error: `A company called "${name}" already exists. Pick a different name.` };
  }

  // Everything already using this name or a suffix of it. Wildcards a
  // caller might have typed only widen the match, and the exact shapes
  // are picked out below, so the pattern needs no escaping.
  const { data: siblings } = await admin
    .from("companies")
    .select("name")
    .ilike("name", `${name}%`)
    .limit(200);

  const taken = new Set(((siblings as { name: string }[] | null) ?? []).map((row) => row.name));
  for (let suffix = 2; suffix <= 50; suffix++) {
    const candidate = `${name} (${suffix})`;
    if (taken.has(candidate)) continue;
    const next = await attempt(candidate);
    if (!next.error && next.data) return { id: (next.data as { id: string }).id };
    // Lost a race to another signup for the same name; try the next one.
    if (!isTaken(next.error)) {
      return { error: next.error?.message ?? "Could not create the company." };
    }
  }
  return { error: "That company name is already taken. Try adding your city to it." };
}

/**
 * What a new company's lists are filled with: a copy of an existing
 * company's, or the fixed defaults.
 *
 * `sourceCompanyId` is how the admin path keeps its behaviour -- a second
 * company made from inside the app looks like the first one. Any list the
 * source turns out not to have falls back to the defaults, so copying can
 * never be the reason a company opens with an empty board.
 *
 * The disposition copy carries move_to_stage and creates_followup_task
 * with it. Leaving them behind, which the previous copy did, handed the
 * new company dispositions that log an outcome and move nothing -- the
 * broken-looking dialer buttons migration 0091 was written to fix.
 */
async function seedRowsFor(sourceCompanyId?: string) {
  if (!sourceCompanyId) {
    return {
      timezone: undefined as string | undefined,
      timeFormat: undefined as string | undefined,
      stages: DEFAULT_PIPELINE_STAGES as object[],
      calendars: DEFAULT_CALENDARS as object[],
      dispositions: DEFAULT_CALL_DISPOSITIONS as object[],
      projectTypes: DEFAULT_PROJECT_TYPES as object[],
      leadSources: DEFAULT_LEAD_SOURCES as object[],
    };
  }

  const admin = createAdminClient();
  const [profile, stages, calendars, dispositions, projectTypes, leadSources] = await Promise.all([
    admin.from("company_profile").select("timezone, time_format").eq("company_id", sourceCompanyId).maybeSingle(),
    admin.from("pipeline_stages").select("name, color, sort_order, is_system").eq("company_id", sourceCompanyId),
    admin.from("calendars").select("name, color, sort_order, is_system").eq("company_id", sourceCompanyId),
    admin
      .from("call_dispositions")
      .select("name, color, sort_order, is_system, move_to_stage, creates_followup_task")
      .eq("company_id", sourceCompanyId),
    admin.from("project_types").select("name, sort_order").eq("company_id", sourceCompanyId),
    admin.from("lead_sources").select("name, sort_order").eq("company_id", sourceCompanyId),
  ]);

  const source = profile.data as { timezone: string | null; time_format: string | null } | null;
  const orDefault = (rows: unknown[] | null, fallback: object[]) =>
    rows && rows.length > 0 ? (rows as object[]) : fallback;

  return {
    timezone: source?.timezone ?? undefined,
    timeFormat: source?.time_format ?? undefined,
    stages: orDefault(stages.data, DEFAULT_PIPELINE_STAGES),
    calendars: orDefault(calendars.data, DEFAULT_CALENDARS),
    dispositions: orDefault(dispositions.data, DEFAULT_CALL_DISPOSITIONS),
    projectTypes: orDefault(projectTypes.data, DEFAULT_PROJECT_TYPES),
    leadSources: orDefault(leadSources.data, DEFAULT_LEAD_SOURCES),
  };
}

/**
 * Builds a working company from nothing: the row, its settings, the owner's
 * membership, and the starter lists without which the app renders empty
 * boards and empty dropdowns (see lib/data/company-defaults.ts).
 *
 * The single answer to "what is a working new company", used by both
 * doors -- the paid signup and Settings' New company button. When there
 * were two, they had already drifted: one seeded a timezone and the other
 * did not, and only one of them carried the dispositions' rules.
 *
 * Service role throughout -- a company this new has no company_members
 * row yet for RLS to check the caller against.
 */
export async function createCompanyWithDefaults(
  name: string,
  ownerProfileId: string,
  options: { sourceCompanyId?: string; onNameClash?: "suffix" | "fail" } = {}
): Promise<{ companyId?: string; error?: string }> {
  const admin = createAdminClient();
  const seed = await seedRowsFor(options.sourceCompanyId);

  const created = await insertCompanyWithUniqueName(name, options.onNameClash ?? "suffix");
  if (!created.id) return { error: created.error };
  const companyId = created.id;

  const withCompany = <T extends object>(rows: T[]) =>
    rows.map((row) => ({ ...row, company_id: companyId }));

  // One wave, not two, but the membership's result is still singled out.
  // Every RLS policy in the database reads company_members, so a company
  // whose owner has no row in it is a company nobody can open -- worse
  // than no company at all, and the one failure here worth unwinding.
  // Missing starter lists, by contrast, can be typed in by hand.
  const [member, ...seeded] = await Promise.all([
    admin.from("company_members").insert({
      profile_id: ownerProfileId,
      company_id: companyId,
      roles: ["Office", "Admin"],
      can_delete_leads: true,
      status: "Active",
    }),
    admin.from("company_profile").insert({
      company_id: companyId,
      name,
      // Omitted rather than defaulted to null: both columns are NOT NULL
      // with defaults of their own ('Pacific', '12h').
      ...(seed.timezone ? { timezone: seed.timezone } : {}),
      ...(seed.timeFormat ? { time_format: seed.timeFormat } : {}),
    }),
    admin.from("pipeline_stages").insert(withCompany(seed.stages)),
    admin.from("calendars").insert(withCompany(seed.calendars)),
    admin.from("call_dispositions").insert(withCompany(seed.dispositions)),
    admin.from("project_types").insert(withCompany(seed.projectTypes)),
    admin.from("lead_sources").insert(withCompany(seed.leadSources)),
  ]);

  if (member.error) {
    await admin.from("companies").delete().eq("id", companyId);
    return { error: member.error.message };
  }

  // Read rather than discarded. A company that quietly lost its
  // pipeline_stages insert opens on a board with no columns, and the
  // owner has no way to tell that from "this is how the product looks".
  const seedErrors = seeded
    .map((result) => result.error?.message)
    .filter((message): message is string => Boolean(message));
  if (seedErrors.length > 0) {
    console.error(
      `[signup] company ${companyId} created with incomplete defaults: ${seedErrors.join("; ")}`
    );
  }

  return { companyId };
}

function inviteEmailBody(companyName: string, link: string): { html: string; text: string } {
  const safeCompany = escapeHtml(companyName);
  const life = `The link works once and expires in ${INVITE_TTL_DAYS} days.`;
  return {
    html:
      `<p>Thanks for signing up${safeCompany ? ` — ${safeCompany}` : ""}.</p>` +
      `<p>One step left: pick a password and your CRM is ready.</p>` +
      `<p><a href="${link}">Finish setting up your account</a></p>` +
      `<p>${life}</p>`,
    text:
      `Thanks for signing up${companyName ? ` — ${companyName}` : ""}.\n\n` +
      `Finish setting up your account: ${link}\n\n` +
      life,
  };
}

/**
 * The outcome of provisioning, as a shape that cannot lie.
 *
 * Two flat objects rather than one with five optional fields: on the
 * success side email and companyName are strings the welcome page can
 * print without a fallback, and on the failure side `retryable` -- the
 * only thing the webhook cares about -- is always there to be read.
 */
export type ProvisionResult =
  | { ok: true; email: string; companyName: string }
  | { ok: false; retryable: boolean; error: string };

/**
 * Turns a paid Checkout Session into an emailed setup link. Safe to call
 * as many times as it happens to be called.
 *
 * Stripe's own guidance is that fulfilment must be driven by webhooks --
 * "you can't rely on triggering fulfillment only from your checkout
 * landing page, because it's not guaranteed customers visit that page" --
 * and that the function "must correctly handle being called multiple
 * times with the same Checkout Session ID". Both apply here: the webhook
 * and the /welcome page call this, the webhook may deliver twice, and a
 * bank debit fires a second event days later when it settles. The unique
 * stripe_session_id column is what makes the second call a no-op.
 *
 * `verified` is the session object out of a signature-checked webhook
 * event, which is the same object this would otherwise fetch. /welcome
 * passes nothing, because its session id comes off a URL the visitor can
 * edit and therefore has to be looked up rather than believed.
 */
export async function provisionSignup(
  sessionId: string,
  verified?: Stripe.Checkout.Session
): Promise<ProvisionResult> {
  if (!sessionId) return { ok: false, retryable: false, error: "Missing checkout session." };

  // Answered from our own table when the email has already gone out --
  // which covers every reload of /welcome and the second webhook of a
  // bank debit. Everything below this line costs a Stripe round trip.
  const already = await sentInviteForSession(sessionId);
  if (already) return { ok: true, email: already.email, companyName: already.company_name };

  const config = signupConfig();
  if (!config) {
    return { ok: false, retryable: false, error: "Signup isn't configured on this deployment." };
  }

  let session: Stripe.Checkout.Session;
  if (verified && verified.id === sessionId) {
    session = verified;
  } else {
    try {
      session = await stripeClient(config.env).checkout.sessions.retrieve(sessionId);
    } catch {
      return { ok: false, retryable: false, error: "We couldn't find that checkout." };
    }
  }

  // 'unpaid' is Stripe's own signal to hold off -- a bank debit sits
  // there until it settles, and fires a second event when it does.
  if (session.payment_status === "unpaid") {
    return {
      ok: false,
      retryable: false,
      error: "This payment hasn't cleared yet. We'll email you the moment it does.",
    };
  }

  // The same test the webhook applies before it calls this. /welcome hands
  // us a session id straight off a URL the visitor can edit, so the two
  // entrances have to agree on what a signup session is -- otherwise this
  // one is defined by "happens to carry a company name", which is a
  // weaker claim than the marker the checkout deliberately set.
  if (session.metadata?.kind !== "crm_signup") {
    return { ok: false, retryable: false, error: "That checkout isn't a CRM signup." };
  }

  const email = (session.customer_details?.email ?? session.customer_email ?? "")
    .trim()
    .toLowerCase();
  const companyName = (session.metadata?.company_name ?? "").trim();
  if (!email) {
    return { ok: false, retryable: false, error: "That checkout has no email address on it." };
  }
  if (!companyName) {
    return { ok: false, retryable: false, error: "That checkout has no company name on it." };
  }

  const { id, token, alreadySent, error } = await createInvite({
    stripeSessionId: session.id,
    email,
    companyName,
    stripeCustomerId: typeof session.customer === "string" ? session.customer : null,
    stripeSubscriptionId: typeof session.subscription === "string" ? session.subscription : null,
    priceId: session.metadata?.price_id ?? null,
  });
  // A database fault here is worth retrying, so the caller is told to let
  // Stripe try again rather than swallowing it.
  if (error) return { ok: false, retryable: true, error };

  // Somebody else already sent this one: the other side of the race, or a
  // duplicate delivery. Nothing to do, and for the person waiting the
  // email is already on its way.
  if (alreadySent || !token || !id) return { ok: true, email, companyName };

  const link = registerUrl(token);
  const body = inviteEmailBody(companyName, link);
  const sent = await sendEmail(email, "Finish setting up your Contractor CRM", body.html, body.text);

  // sendEmail reports failures by returning them rather than throwing, so
  // an unchecked call is a signup that silently never arrives. The invite
  // row stays behind with no send time on it, which is what lets the
  // retry mint a fresh code and try again.
  if (sent.error) return { ok: false, retryable: true, error: sent.error };

  // Also retryable: an unrecorded send is worse than a failed one. Left
  // as "unsent", the next attempt mints a fresh code and overwrites the
  // hash, which kills the link that is already in their inbox. Retrying
  // costs a duplicate email; not retrying costs them the working one.
  const marked = await markInviteSent(id);
  if (marked.error) return { ok: false, retryable: true, error: marked.error };

  return { ok: true, email, companyName };
}
