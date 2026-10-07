"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile, type Profile } from "@/lib/data/profile";
import { canCreateEstimates, canManageBills, depositCents, isAdminRole, moneyCents } from "@/lib/data/types";
import { isMissingSchemaError } from "@/lib/schema-drift";
import { lockedServicesError } from "@/lib/billing/company-lock";
import { getEmailForCompany } from "@/lib/email-company";
import { sendEmail } from "@/lib/email-env";
import { sendTwilioSms } from "@/lib/twilio-env";
import { getTwilioForSending } from "@/lib/twilio-company";
import { personName } from "@/lib/data/client-name";
import { advanceStageOnFinancing } from "@/lib/pipeline/advance-stage";
import { companyToday } from "@/lib/data/company-today";
import {
  FINANCING_STATUS_LABEL,
  financingEmail,
  financingEventError,
  financingSettingsError,
  financingText,
  estimateLender,
  feeBpFromPercent,
  financingOffered,
  followUpDue,
  lenderChoiceError,
  followUpTitle,
  movesToPendingFinance,
  readFinancing,
  remindsFor,
  splitFundedLoan,
  type EstimateLender,
  type FinancingStatus,
} from "@/lib/financing";

/**
 * The company's customer financing (DECISIONS #161): the lender it uses
 * and the application link that lender gave it. Office or Admin set it,
 * like the rest of the company's settings.
 */

const NEEDS_0214 = "Financing needs a database update first: run 0214_customer_financing.sql in Supabase.";

export type FinancingSettings = {
  provider: string;
  url: string;
  ready: boolean;
  /** What's wrong with the link as saved, so customers aren't being shown
   *  the offer (#161: a lender's page that turns them away). */
  problem: string | null;
  /** Offering financing per customer, and the lender's fee (0219, #169). */
  offer: { ready: boolean; byDefault: boolean; feeBp: number | null };
};

export async function getFinancingSettings(): Promise<FinancingSettings | null> {
  const profile = await getCurrentProfile();
  if (!profile || !isAdminRole(profile)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_profile")
    .select("financing_provider, financing_url")
    .eq("company_id", profile.company_id)
    .maybeSingle<{ financing_provider: string | null; financing_url: string | null }>();
  const provider = data?.financing_provider ?? "";
  const url = data?.financing_url ?? "";
  return {
    provider,
    url,
    ready: !error,
    problem: url ? financingSettingsError({ provider, url }) : null,
    offer: await offerSettings(supabase, profile.company_id),
  };
}

/** The company's default and fee (0219), read on their own: every column,
 *  so a database without them reads as before (offered, no fee). */
async function offerSettings(
  db: { from: Admin["from"] } | Awaited<ReturnType<typeof createClient>>,
  companyId: string
): Promise<FinancingSettings["offer"]> {
  const { data } = await (db as Admin)
    .from("company_profile")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle<Record<string, unknown>>();
  const ready = !!data && "financing_fee_bp" in data;
  return {
    ready,
    byDefault: ready ? data!.financing_offer_default !== false : true,
    feeBp: ready && typeof data!.financing_fee_bp === "number" ? (data!.financing_fee_bp as number) : null,
  };
}

const NEEDS_0219 = "This needs a database update first: run 0219_financing_offer.sql in Supabase.";

/**
 * Whether new estimates offer financing, and the lender's fee (DECISIONS
 * #169). Office or Admin, like the rest of the company's settings.
 */
export async function saveFinancingOffer(input: {
  offerByDefault: boolean;
  feePercent: string;
}): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "Only Office or Admin users can change this." };
  const fee = feeBpFromPercent(input.feePercent ?? "");
  if ("error" in fee) return { error: fee.error };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_profile")
    .update({ financing_offer_default: input.offerByDefault === true, financing_fee_bp: fee.bp })
    .eq("company_id", profile.company_id)
    .select("company_id");
  if (error) return { error: isMissingSchemaError(error) ? NEEDS_0219 : error.message };
  if (!data?.length) return { error: "That change couldn't be saved." };

  revalidatePath("/settings/customer-financing");
  return {};
}

export async function saveFinancingSettings(input: { provider: string; url: string }): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "Only Office or Admin users can change this." };
  const why = financingSettingsError(input);
  if (why) return { error: why };
  const provider = input.provider.trim();
  const url = input.url.trim();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_profile")
    .update({ financing_provider: provider || null, financing_url: url || null })
    .eq("company_id", profile.company_id)
    .select("company_id");
  if (error) return { error: isMissingSchemaError(error) ? NEEDS_0214 : error.message };
  if (!data?.length) return { error: "That change couldn't be saved." };

  revalidatePath("/settings/customer-financing");
  return {};
}

// ---------------------------------------------------------------------
// On the estimate (DECISIONS #162): send the customer the link, and keep
// track of where the application stands. The people who work estimates
// or record payments; the lender's answer is entered by hand.

const NEEDS_0215 = "Financing tracking needs a database update first: run 0215_estimate_financing.sql in Supabase.";

const NEEDS_0216 =
  "Follow-up reminders need a database update first: run 0216_financing_follow_ups.sql in Supabase. Or untick the reminder.";

const canWorkFinancing = (p: Profile) => canCreateEstimates(p) || canManageBills(p);

type Admin = ReturnType<typeof createAdminClient>;

type FinancingDoc = {
  id: string;
  company_id: string;
  lead_id: string;
  doc_number: string;
  title: string | null;
  kind: string | null;
  status: string;
  total_cents: number;
  deposit_percent_bp: number;
  deposit_cap_cents: number;
};

/** The estimate, if it's this company's and one financing goes with:
 *  an estimate, contract or change order that's out, not a draft or one
 *  closed. */
async function financingDoc(admin: Admin, estimateId: string, companyId: string) {
  const { data } = await admin
    .from("estimates")
    .select("id, company_id, lead_id, doc_number, title, kind, status, total_cents, deposit_percent_bp, deposit_cap_cents")
    .eq("id", estimateId)
    .eq("company_id", companyId)
    .maybeSingle<FinancingDoc>();
  if (!data) return { error: "That estimate no longer exists." as const };
  const kind = data.kind ?? "contract";
  if (kind !== "contract" && kind !== "change_order") return { error: "Financing goes with an estimate or contract." as const };
  if (data.status === "Draft") return { error: "Send the estimate first." as const };
  if (data.status === "Void" || data.status === "Declined") return { error: "This estimate is closed." as const };
  return { doc: data };
}

// Who is financing it (DECISIONS #168): the company's lender, the
// customer's own, or nobody -- chosen on the estimate (0218).

const NEEDS_0218 = "Choosing the customer's own lender needs a database update first: run 0218_customer_own_lender.sql in Supabase.";

/** Who the step, the payout and the follow-up are with. `ready`: 0218
 *  has run, so a step can carry the lender's name. */
type Who = {
  chosen: EstimateLender | null;
  ready: boolean;
  companyName: string | null;
  /** Financing is offered to this customer (#169). */
  offered: boolean;
  /** The lender's fee, hundredths of a percent, when set (#169). */
  feeBp: number | null;
};

async function lenderOf(admin: Admin, doc: FinancingDoc): Promise<Who> {
  const [{ data: row }, { data: company }] = await Promise.all([
    // Every column, so the choice comes along where 0218 has run and
    // nothing breaks where it hasn't.
    admin.from("estimates").select("*").eq("id", doc.id).eq("company_id", doc.company_id).maybeSingle<Record<string, unknown>>(),
    // Every column too: the offer default and fee (0219) where they exist.
    admin
      .from("company_profile")
      .select("*")
      .eq("company_id", doc.company_id)
      .maybeSingle<{
        name: string | null;
        financing_provider: string | null;
        financing_url: string | null;
        financing_offer_default?: boolean | null;
        financing_fee_bp?: number | null;
      }>(),
  ]);
  const ready = !!row && "financing_source" in row;
  const chosen = estimateLender(
    { source: (row?.financing_source as string | null) ?? null, lender: (row?.financing_lender as string | null) ?? null },
    readFinancing(company)
  );
  return {
    chosen,
    ready,
    companyName: company?.name ?? null,
    offered: financingOffered(row?.financing_offered as boolean | null | undefined, company?.financing_offer_default),
    feeBp: typeof company?.financing_fee_bp === "number" ? company.financing_fee_bp : null,
  };
}

/** Offers financing to this customer, or stops (DECISIONS #169). */
export async function setFinancingOffered(input: { estimateId: string; offered: boolean }): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canWorkFinancing(profile)) return { error: "Only people who work estimates or record payments can do this." };
  const admin = createAdminClient();
  const found = await financingDoc(admin, input.estimateId, profile.company_id);
  if ("error" in found) return { error: found.error };
  const { error } = await admin
    .from("estimates")
    .update({ financing_offered: input.offered === true })
    .eq("id", found.doc.id)
    .eq("company_id", found.doc.company_id);
  if (error) return { error: isMissingSchemaError(error) ? NEEDS_0219 : error.message };
  revalidatePath(`/estimates/${found.doc.id}`);
  return {};
}

/**
 * Says who is financing this job: the company's lender, the customer's
 * own (named), or nobody. Not while a payment change is waiting or in
 * force: it's worded for the lender it was sent with.
 */
export async function setFinancingLender(input: {
  estimateId: string;
  source: string;
  lender?: string | null;
}): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canWorkFinancing(profile)) return { error: "Only people who work estimates or record payments can do this." };
  const why = lenderChoiceError(input);
  if (why) return { error: why };

  const admin = createAdminClient();
  const found = await financingDoc(admin, input.estimateId, profile.company_id);
  if ("error" in found) return { error: found.error };
  const doc = found.doc;

  const { data: open } = await admin
    .from("contract_payment_changes")
    .select("id")
    .eq("estimate_id", doc.id)
    .eq("company_id", doc.company_id)
    .in("status", ["sent", "signed"])
    .limit(1);
  if (open?.length) {
    return {
      error: "A payment change is waiting or in force on this contract. Take it back, or put the original schedule back, first.",
    };
  }

  const { error } = await admin
    .from("estimates")
    .update({
      financing_source: input.source,
      financing_lender: input.source === "customer" ? input.lender!.trim() : null,
    })
    .eq("id", doc.id)
    .eq("company_id", doc.company_id);
  if (error) return { error: isMissingSchemaError(error) ? NEEDS_0218 : error.message };

  revalidatePath(`/estimates/${doc.id}`);
  revalidatePath("/pipeline");
  return {};
}

// Follow-ups (DECISIONS #164): a link sent or an application in can put
// a task on the list of whoever recorded it, a few days out. The step
// remembers its task (0216), so the next step can close it.

/** 0216 has run: a step can remember its follow-up task. */
async function followUpsReady(admin: Admin): Promise<boolean> {
  const { error } = await admin.from("estimate_financing_events").select("follow_up_task_id").limit(0);
  return !error;
}

/** The follow-up task for a step, on `profileId`'s list. */
async function startFollowUp(
  admin: Admin,
  doc: FinancingDoc,
  profileId: string,
  status: "sent" | "applied",
  days: number,
  /** Who it's with (#168), for the task's wording. */
  lenderName: string | null
): Promise<{ id: string; due: string } | { error: string }> {
  const due = followUpDue(await companyToday(), days);
  const { data, error } = await admin
    .from("lead_tasks")
    .insert({
      lead_id: doc.lead_id,
      title: followUpTitle(status, doc.doc_number, lenderName),
      due_date: due,
      assigned_to: profileId,
      created_by: profileId,
      company_id: doc.company_id,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) return { error: `the follow-up task couldn't be made (${error?.message ?? "no task came back"})` };
  return { id: data.id, due };
}

/** Closes the follow-ups earlier steps on this estimate left open, but
 *  `keep`: the step they waited on has come. Best effort. */
async function closeFollowUps(admin: Admin, doc: FinancingDoc, keep: string | null) {
  const { data } = await admin
    .from("estimate_financing_events")
    .select("follow_up_task_id")
    .eq("estimate_id", doc.id)
    .eq("company_id", doc.company_id)
    .not("follow_up_task_id", "is", null)
    .returns<{ follow_up_task_id: string }[]>();
  const open = (data ?? []).map((row) => row.follow_up_task_id).filter((id) => id !== keep);
  if (!open.length) return;
  await admin
    .from("lead_tasks")
    .update({ completed_at: new Date().toISOString() })
    .in("id", open)
    .eq("company_id", doc.company_id)
    .is("completed_at", null);
}

/**
 * A step on the estimate, with its follow-up task when one was asked for
 * and the step is one to follow up. A step that can't be saved leaves no
 * task behind. Then the earlier steps' follow-ups are closed.
 */
async function saveStep(
  admin: Admin,
  doc: FinancingDoc,
  profileId: string,
  step: { status: FinancingStatus; amount_cents?: number | null; note?: string | null; channel?: string | null },
  remindInDays: number | null | undefined,
  who: Who
): Promise<{ error?: string; followUpOn?: string }> {
  let followUp: { id: string; due: string } | null = null;
  if (remindInDays && remindsFor(step.status)) {
    const started = await startFollowUp(
      admin,
      doc,
      profileId,
      step.status as "sent" | "applied",
      remindInDays,
      who.chosen?.name ?? null
    );
    if ("error" in started) return { error: started.error };
    followUp = started;
  }
  const { error } = await admin.from("estimate_financing_events").insert({
    company_id: doc.company_id,
    estimate_id: doc.id,
    ...step,
    created_by: profileId,
    // Only with a task, so a company that hasn't run 0216 can still save.
    ...(followUp ? { follow_up_task_id: followUp.id } : {}),
    // Who it was with (#168), where 0218 has run.
    ...(who.ready ? { lender: who.chosen?.name ?? null } : {}),
  });
  if (error) {
    if (followUp) await admin.from("lead_tasks").delete().eq("id", followUp.id).eq("company_id", doc.company_id);
    return { error: isMissingSchemaError(error) ? NEEDS_0215 : error.message };
  }
  await closeFollowUps(admin, doc, followUp?.id ?? null);
  return { followUpOn: followUp?.due };
}

export async function recordFinancingStatus(input: {
  estimateId: string;
  status: string;
  amountCents?: number | null;
  note?: string | null;
  /** Funded: also record the payout as payments on the contract (#163),
   *  and what the lender kept as a job cost (#169). */
  payment?: { receivedOn?: string | null; reference?: string | null; feeCents?: number | null } | null;
  /** Sent or Applied: a follow-up task this many days out (#164). */
  remindInDays?: number | null;
}): Promise<{
  error?: string;
  ok?: boolean;
  movedTo?: string;
  paidCents?: number;
  /** What the lender kept, saved as a job cost (#169). */
  feeCents?: number;
  warning?: string;
  followUpOn?: string;
}> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canWorkFinancing(profile)) return { error: "Only people who work estimates or record payments can do this." };
  const why = financingEventError(input);
  if (why) return { error: why };
  const status = input.status as FinancingStatus;

  const admin = createAdminClient();
  const found = await financingDoc(admin, input.estimateId, profile.company_id);
  if ("error" in found) return { error: found.error };
  const doc = found.doc;
  const remindInDays = remindsFor(status) ? input.remindInDays : null;
  if (remindInDays && !(await followUpsReady(admin))) return { error: NEEDS_0216 };
  const who = await lenderOf(admin, doc);

  // Funded, and recorded as the money it is (DECISIONS #163): the lender
  // paid the contractor, so the payout settles what's left on the
  // contract -- the deposit first, then each stage in order -- as
  // Financing payments, like any payment recorded by hand. Before the
  // step, so a payout that can't be recorded records no Funded.
  let paidCents = 0;
  let feeRecorded = 0;
  let feeWarning: string | undefined;
  if (input.payment) {
    if (status !== "funded") return { error: "Only a funded loan is recorded as a payment." };
    if (!canManageBills(profile)) {
      return { error: "Only Bookkeeping, Office or Admin users can record a payment." };
    }
    if (doc.status !== "Signed") {
      return { error: "The contract isn't signed yet, so there's nothing to pay against." };
    }
    const amountCents = input.amountCents ?? 0;
    if (amountCents <= 0) return { error: "Enter the amount the lender paid out." };
    const feeCents = Math.round(Number(input.payment.feeCents ?? 0)) || 0;
    if (feeCents < 0 || feeCents > amountCents) return { error: "The lender's fee can't be more than the payout." };

    const [{ data: stages }, { data: payments }] = await Promise.all([
      admin
        .from("estimate_payments")
        .select("*")
        .eq("estimate_id", doc.id)
        .eq("company_id", profile.company_id)
        .returns<
          { id: string; name: string; sort_order: number; amount_cents: number; credit_cents?: number | null; cancelled_at?: string | null }[]
        >(),
      admin
        .from("portal_payments")
        .select("estimate_payment_id, kind, status, amount_cents, stripe_session_id, stripe_payment_intent_id")
        .eq("estimate_id", doc.id)
        .returns<
          {
            estimate_payment_id: string | null;
            kind: string;
            status: string;
            amount_cents: number;
            stripe_session_id: string | null;
            stripe_payment_intent_id: string | null;
          }[]
        >(),
    ]);
    const split = splitFundedLoan({
      amountCents,
      depositDueCents: depositCents(doc.total_cents, doc.deposit_percent_bp, doc.deposit_cap_cents),
      stages: stages ?? [],
      payments: payments ?? [],
    });
    if (split.overCents > 0) {
      return { error: `That's more than is still owed on this contract (${moneyCents(split.openCents)}).` };
    }

    const day = input.payment.receivedOn && /^\d{4}-\d{2}-\d{2}$/.test(input.payment.receivedOn) ? input.payment.receivedOn : null;
    const receivedAt = day ? new Date(`${day}T12:00:00`).toISOString() : new Date().toISOString();
    const lender = who.chosen?.name;
    const { data: inserted, error: payError } = await admin
      .from("portal_payments")
      .insert(
        split.parts.map((part) => ({
          company_id: doc.company_id,
          estimate_id: doc.id,
          estimate_payment_id: part.phaseId,
          lead_id: doc.lead_id,
          kind: part.phaseId ? "progress" : "deposit",
          amount_cents: part.cents,
          status: "succeeded",
          method: "financing",
          source: "manual",
          recorded_by: profile.id,
          reference: input.payment?.reference?.trim() || null,
          note: lender ? `Funded loan from ${lender}` : "Funded loan",
          paid_at: receivedAt,
          created_at: receivedAt,
        }))
      )
      .select("id");
    if (payError || (inserted?.length ?? 0) !== split.parts.length) {
      return { error: payError?.message || "The payment couldn't be recorded." };
    }
    paidCents = amountCents;

    // What the lender kept (#169): a cost of this job, so its profit is
    // what the loan really brought in. Not for the customer's own loan --
    // their bank charges them, not the company.
    if (feeCents > 0 && !who.chosen?.own) {
      const { error: feeError } = await admin
        .from("job_expenses")
        .insert({
          company_id: doc.company_id,
          lead_id: doc.lead_id,
          estimate_payment_id: null,
          vendor: lender || null,
          category: "Financing fee",
          description: `${lender ? `${lender} dealer fee` : "Lender's fee"} on ${doc.doc_number}`,
          amount_cents: feeCents,
          spent_on: day ?? (await companyToday()),
          source: "manual",
          created_by: profile.id,
        });
      if (feeError) feeWarning = `The payment was recorded, but the lender's fee wasn't saved as a job cost: ${feeError.message}`;
      else feeRecorded = feeCents;
    }
  }

  const note = [input.note?.trim(), paidCents ? "Recorded as a payment on the contract." : null].filter(Boolean).join(" ");
  const saved = await saveStep(
    admin,
    doc,
    profile.id,
    { status, amount_cents: input.amountCents ?? null, note: note || null },
    remindInDays,
    who
  );
  if (saved.error) {
    const why = saved.error.charAt(0).toUpperCase() + saved.error.slice(1);
    return { error: paidCents ? `The payment was recorded, but the Funded step wasn't saved: ${saved.error}` : why };
  }

  // Applied or approved: the lead is at Pending Finance (by its tag, so
  // under whatever this company calls it), unless it's further along.
  let movedTo: string | undefined;
  const { data: lead } = await admin
    .from("leads")
    .select("stage_key")
    .eq("id", doc.lead_id)
    .eq("company_id", profile.company_id)
    .maybeSingle<{ stage_key: string | null }>();
  if (lead && movesToPendingFinance(status, lead.stage_key)) {
    const move = await advanceStageOnFinancing(admin, doc.lead_id, profile.company_id);
    if (move.moved && move.to) {
      movedTo = move.to;
      await admin.from("lead_notes").insert({
        company_id: profile.company_id,
        lead_id: doc.lead_id,
        author_id: profile.id,
        body: `Moved to ${move.to}: financing ${FINANCING_STATUS_LABEL[status].toLowerCase()} on ${doc.doc_number}.`,
      });
    }
  }

  revalidatePath(`/estimates/${doc.id}`);
  revalidatePath("/pipeline");
  if (saved.followUpOn) revalidatePath("/tasks");
  if (paidCents) {
    revalidatePath("/payments");
    revalidatePath("/invoices");
    revalidatePath("/collect");
  }
  if (feeRecorded) revalidatePath("/profit-loss");
  return {
    ok: true,
    movedTo,
    paidCents: paidCents || undefined,
    feeCents: feeRecorded || undefined,
    warning: feeWarning,
    followUpOn: saved.followUpOn,
  };
}

export async function sendFinancingLink(input: {
  estimateId: string;
  channel: "text" | "email" | "both";
  /** A follow-up task this many days out (#164). */
  remindInDays?: number | null;
}): Promise<{ error?: string; sentBy?: string; followUpOn?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canWorkFinancing(profile)) return { error: "Only people who work estimates or record payments can do this." };
  if (!["text", "email", "both"].includes(input.channel)) return { error: "Pick text or email." };
  // Paused while the company's subscription is locked (DECISIONS #131).
  const locked = await lockedServicesError(profile.company_id);
  if (locked) return { error: locked };

  const admin = createAdminClient();
  const found = await financingDoc(admin, input.estimateId, profile.company_id);
  if ("error" in found) return { error: found.error };
  const doc = found.doc;
  // Before anything goes out, so a reminder asked for isn't silently lost.
  if (input.remindInDays && !(await followUpsReady(admin))) return { error: NEEDS_0216 };

  const [who, { data: lead }] = await Promise.all([
    lenderOf(admin, doc),
    admin
      .from("leads")
      .select("id, contact_type, first_name, last_name, email, phone")
      .eq("id", doc.lead_id)
      .eq("company_id", profile.company_id)
      .maybeSingle<{
        id: string;
        contact_type: string | null;
        first_name: string | null;
        last_name: string | null;
        email: string | null;
        phone: string | null;
      }>(),
  ]);
  // Only the company's lender has a link to apply with (#168).
  const chosen = who.chosen;
  if (!chosen?.applyUrl) {
    return {
      error: chosen?.own
        ? "This customer is financing through their own lender, so there's no link to send."
        : "Add your lender's link under Settings › Customer Financing first.",
    };
  }
  // Not offered to this customer (#169): turned on first, on purpose.
  if (!who.offered) {
    return { error: "Financing isn't offered to this customer. Turn on \"Offer financing to this customer\" first." };
  }
  const financing = { provider: chosen.name, url: chosen.applyUrl };
  if (!lead) return { error: "Customer not found." };
  const companyName = who.companyName || "Your contractor";

  const wantText = input.channel !== "email";
  const wantEmail = input.channel !== "text";
  if (wantText && !lead.phone) return { error: "This customer has no phone number on file." };
  if (wantEmail && !lead.email) return { error: "This customer has no email address on file." };

  const went: ("text" | "email")[] = [];
  const problems: string[] = [];

  if (wantEmail && lead.email) {
    const mail = financingEmail({
      companyName,
      customerName: personName(lead) || null,
      provider: financing.provider,
      url: financing.url,
      docNumber: doc.doc_number,
      title: doc.title,
    });
    const emailEnv = await getEmailForCompany(profile.company_id);
    if (!emailEnv) {
      problems.push("email isn't set up for this company yet");
    } else {
      const sent = await sendEmail(lead.email, mail.subject, mail.html, mail.text, {
        env: emailEnv,
        replyTo: emailEnv.replyTo ?? undefined,
      });
      if (sent.error) {
        problems.push(`the email failed (${sent.error})`);
      } else {
        went.push("email");
        await admin.from("sms_messages").insert({
          lead_id: lead.id,
          direction: "outbound",
          from_number: "email",
          to_number: lead.email,
          sent_by: profile.id,
          body: `[Financing link emailed] ${mail.subject}`,
          twilio_sid: sent.id || null,
          channel: "email",
          company_id: profile.company_id,
        });
      }
    }
  }

  if (wantText && lead.phone) {
    const twilioEnv = await getTwilioForSending(profile.company_id);
    if (!twilioEnv) {
      problems.push("texting isn't set up for this company yet");
    } else {
      const body = financingText({ companyName, provider: financing.provider, url: financing.url, docNumber: doc.doc_number });
      const sent = await sendTwilioSms(lead.phone, body, twilioEnv);
      if (sent.error) {
        problems.push(`the text failed (${sent.error})`);
      } else {
        went.push("text");
        await admin.from("sms_messages").insert({
          lead_id: lead.id,
          direction: "outbound",
          from_number: twilioEnv.phoneNumber,
          to_number: lead.phone,
          sent_by: profile.id,
          body,
          twilio_sid: sent.sid || null,
          channel: "sms",
          company_id: profile.company_id,
        });
      }
    }
  }

  if (!went.length) return { error: `The link wasn't sent: ${problems.join("; ")}.` };

  // A step of its own on the estimate, with its follow-up. The link
  // already went, so a step that can't be saved is said, not undone.
  const saved = await saveStep(
    admin,
    doc,
    profile.id,
    { status: "sent", channel: went.length === 2 ? "both" : went[0] },
    input.remindInDays,
    who
  );
  if (saved.error) problems.push(`it isn't on the estimate's financing steps: ${saved.error}`);

  revalidatePath(`/estimates/${doc.id}`);
  revalidatePath("/pipeline");
  if (saved.followUpOn) revalidatePath("/tasks");
  const sentBy = went.length === 2 ? "text and email" : went[0];
  const followUpOn = saved.followUpOn;
  return problems.length ? { sentBy, followUpOn, error: `Sent by ${sentBy}, but ${problems.join("; ")}.` } : { sentBy, followUpOn };
}
