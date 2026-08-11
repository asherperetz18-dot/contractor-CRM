"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { computeDispatcherCommissions, isAdminRole } from "@/lib/data/types";

export type DispatcherOption = { id: string; name: string };

/**
 * People who can hold a lead as dispatcher.
 *
 * Read through the admin client because company_members carries other
 * people's roles, which a scoped user cannot select for themselves --
 * and the picker has to list colleagues, not just the reader.
 */
export async function getDispatchers(): Promise<DispatcherOption[]> {
  const profile = await getCurrentProfile();
  if (!profile) return [];

  const admin = createAdminClient();
  const { data: members } = await admin
    .from("company_members")
    .select("profile_id, roles")
    .eq("company_id", profile.company_id)
    .eq("status", "Active")
    .returns<{ profile_id: string; roles: string[] }[]>();

  const ids = (members ?? [])
    .filter((m) => (m.roles ?? []).includes("Dispatch"))
    .map((m) => m.profile_id);
  if (ids.length === 0) return [];

  const { data: people } = await admin
    .from("profiles")
    .select("id, name, email")
    .in("id", ids)
    .returns<{ id: string; name: string | null; email: string | null }[]>();

  return (people ?? [])
    .map((p) => ({ id: p.id, name: p.name || p.email || "Unnamed" }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Puts a lead in a dispatcher's name, or takes it back out.
 *
 * The dispatcher is paid a percentage of whatever this lead sells for,
 * so ownership is not a label -- reassigning one moves money. Office and
 * Admin can set anyone. A dispatcher can only claim something nobody
 * holds, or let go of their own; they cannot take a colleague's lead,
 * which is the whole point of the pool.
 */
export async function setLeadDispatcher(
  leadId: string,
  dispatcherId: string | null
): Promise<{ error?: string; ok?: boolean }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  const { data: lead } = await supabase
    .from("leads")
    .select("id, dispatcher_id, company_id")
    .eq("id", leadId)
    .eq("company_id", profile.company_id)
    .maybeSingle<{ id: string; dispatcher_id: string | null; company_id: string }>();
  if (!lead) return { error: "Contact not found." };

  if (!isAdminRole(profile)) {
    const isDispatcher = (profile.roles ?? []).includes("Dispatch");
    if (!isDispatcher) return { error: "Only a dispatcher, Office or Admin can do that." };

    const claimingForSelf = dispatcherId === profile.id;
    const releasingOwn = dispatcherId === null && lead.dispatcher_id === profile.id;
    if (!claimingForSelf && !releasingOwn) {
      return { error: "You can only claim an unassigned lead, or release your own." };
    }
    // Losing a claimed lead loses the commission on it, so taking one
    // from a colleague is not something to allow quietly.
    if (claimingForSelf && lead.dispatcher_id && lead.dispatcher_id !== profile.id) {
      return { error: "Another dispatcher already has this lead." };
    }
  }

  // Written as the signed-in user. The checks above are kept because they
  // say why -- "another dispatcher already has this lead" is a better
  // answer than a refusal -- but leads_update now enforces the same rule,
  // so the database has the final say rather than taking this action's
  // word for it.
  const { data, error } = await supabase
    .from("leads")
    .update({ dispatcher_id: dispatcherId })
    .eq("id", leadId)
    .eq("company_id", profile.company_id)
    .select("id");
  // Row count rather than a missing error: RLS blocks by matching zero
  // rows and raises nothing.
  if (error) return { error: error.message };
  if (!data?.length) return { error: "That lead couldn't be updated." };

  revalidatePath("/pipeline");
  revalidatePath("/calendar");
  revalidatePath("/commissions");
  return { ok: true };
}

export type CommissionJob = {
  estimateId: string;
  docNumber: string;
  customerName: string;
  contractCents: number;
  collectedCents: number;
  commissionCents: number;
};

export type CommissionRow = {
  dispatcherId: string;
  dispatcherName: string;
  jobsSold: number;
  contractCents: number;
  collectedCents: number;
  /** Earned on what sold. */
  commissionCents: number;
  /** The share of that backed by money actually in the bank. */
  earnedOnCollectedCents: number;
  /** The contracts behind the total, so the number can be checked. */
  jobs: CommissionJob[];
};

/**
 * What each dispatcher has earned.
 *
 * Two figures on purpose. Commission is earned when the job sells, but
 * paying 1% of a $50,000 contract that has taken $500 so far is a
 * cash-flow trap -- so the collected-backed figure sits beside it and
 * the contractor decides which one they pay against.
 */
export async function getDispatcherCommissions(): Promise<{
  error?: string;
  rows?: CommissionRow[];
  ratePercent?: number;
}> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const admin = createAdminClient();
  const { data: settings } = await admin
    .from("company_profile")
    .select("dispatcher_commission_bp")
    .eq("company_id", profile.company_id)
    .maybeSingle<{ dispatcher_commission_bp: number }>();
  const bp = settings?.dispatcher_commission_bp ?? 100;

  const { data: signed } = await admin
    .from("estimates")
    .select("id, doc_number, lead_id, total_cents")
    .eq("company_id", profile.company_id)
    .eq("status", "Signed")
    // Contracts only. A change order is a signed estimate too, so
    // without this every extra would quietly enter the commission base
    // -- and commission was deliberately set to the original contract.
    .eq("kind", "contract")
    .returns<{ id: string; doc_number: string; lead_id: string; total_cents: number }[]>();
  if (!signed?.length) return { rows: [], ratePercent: bp / 100 };

  const leadIds = [...new Set(signed.map((e) => e.lead_id))];
  // Names come along so each contract can be listed by customer rather
  // than by a document number nobody remembers.
  const { data: leadRows } = await admin
    .from("leads")
    .select("id, dispatcher_id, first_name, last_name")
    .in("id", leadIds)
    .returns<
      { id: string; dispatcher_id: string | null; first_name: string | null; last_name: string | null }[]
    >();
  const dispatcherByLead = new Map(
    (leadRows ?? [])
      .filter((l) => l.dispatcher_id)
      .map((l) => [l.id, l.dispatcher_id as string])
  );
  const customerByLead = new Map(
    (leadRows ?? []).map((l) => [
      l.id,
      [l.first_name, l.last_name].filter(Boolean).join(" ").trim() || "Unnamed",
    ])
  );

  const { data: payments } = await admin
    .from("portal_payments")
    .select("estimate_id, amount_cents, status")
    .eq("company_id", profile.company_id)
    .eq("status", "succeeded")
    .returns<{ estimate_id: string; amount_cents: number; status: string }[]>();
  const collectedByEstimate = new Map<string, number>();
  for (const p of payments ?? []) {
    collectedByEstimate.set(p.estimate_id, (collectedByEstimate.get(p.estimate_id) ?? 0) + p.amount_cents);
  }

  const computed = computeDispatcherCommissions({
    signed,
    dispatcherByLead,
    collectedByEstimate,
    commissionBp: bp,
  });
  const byDispatcher = new Map<string, CommissionRow>(
    computed.map((c) => [c.dispatcherId, { ...c, dispatcherName: "Unknown", jobs: [] }])
  );

  // The contracts behind each total. Without these the report is a
  // number you cannot check -- "is my job in there?" was unanswerable,
  // which is exactly how a correct figure still gets doubted.
  for (const estimate of signed) {
    const who = dispatcherByLead.get(estimate.lead_id);
    if (!who) continue;
    const row = byDispatcher.get(who);
    if (!row) continue;
    const collected = Math.min(collectedByEstimate.get(estimate.id) ?? 0, estimate.total_cents);
    row.jobs.push({
      estimateId: estimate.id,
      docNumber: estimate.doc_number,
      customerName: customerByLead.get(estimate.lead_id) ?? "Unnamed",
      contractCents: estimate.total_cents,
      collectedCents: collected,
      commissionCents: Math.round((estimate.total_cents * bp) / 10000),
    });
  }
  for (const row of byDispatcher.values()) {
    row.jobs.sort((a, b) => b.contractCents - a.contractCents);
  }

  const { data: people } = await admin
    .from("profiles")
    .select("id, name, email")
    .in("id", [...byDispatcher.keys()])
    .returns<{ id: string; name: string | null; email: string | null }[]>();
  for (const p of people ?? []) {
    const row = byDispatcher.get(p.id);
    if (row) row.dispatcherName = p.name || p.email || "Unnamed";
  }

  // A dispatcher sees their own line; Office and Admin see everyone.
  const rows = [...byDispatcher.values()].filter(
    (r) => isAdminRole(profile) || r.dispatcherId === profile.id
  );
  rows.sort((a, b) => b.commissionCents - a.commissionCents);
  return { rows, ratePercent: bp / 100 };
}

export type DispatcherContext = {
  selfId: string;
  /** Office and Admin choose anyone; a dispatcher can only claim or release. */
  canAssignAnyone: boolean;
  isDispatcher: boolean;
};

/**
 * Who is looking, so the picker can render the right control.
 *
 * Fetched by the component rather than passed down, so adding this to
 * the appointment modal does not mean threading two more props through
 * every screen that opens one.
 */
export async function getDispatcherContext(): Promise<DispatcherContext | null> {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  return {
    selfId: profile.id,
    canAssignAnyone: isAdminRole(profile),
    isDispatcher: (profile.roles ?? []).includes("Dispatch"),
  };
}

export type EventOwner = { eventId: string; dispatcherName: string | null; isMine: boolean };

/**
 * Who holds the lead behind each appointment.
 *
 * Needed because a dispatcher can see every appointment but only their
 * own leads -- so the name of the colleague who owns one is not
 * reachable through any query they are allowed to make. Read with the
 * service role and narrowed to a single name: enough to say "this is
 * Vanessa's" and nothing more about her customer.
 *
 * Without it a dispatcher meets appointments they simply cannot edit,
 * with no explanation on screen.
 */
export async function getEventOwners(eventIds: string[]): Promise<EventOwner[]> {
  const profile = await getCurrentProfile();
  if (!profile || eventIds.length === 0) return [];

  const admin = createAdminClient();
  const { data: events } = await admin
    .from("events")
    .select("id, lead_id")
    .eq("company_id", profile.company_id)
    .in("id", eventIds)
    .returns<{ id: string; lead_id: string | null }[]>();
  if (!events?.length) return [];

  const leadIds = [...new Set(events.map((e) => e.lead_id).filter(Boolean) as string[])];
  if (leadIds.length === 0) {
    return events.map((e) => ({ eventId: e.id, dispatcherName: null, isMine: true }));
  }

  const { data: leads } = await admin
    .from("leads")
    .select("id, dispatcher_id")
    .in("id", leadIds)
    .returns<{ id: string; dispatcher_id: string | null }[]>();
  const dispatcherByLead = new Map((leads ?? []).map((l) => [l.id, l.dispatcher_id]));

  const dispatcherIds = [...new Set([...dispatcherByLead.values()].filter(Boolean) as string[])];
  const { data: people } = dispatcherIds.length
    ? await admin
        .from("profiles")
        .select("id, name, email")
        .in("id", dispatcherIds)
        .returns<{ id: string; name: string | null; email: string | null }[]>()
    : { data: [] };
  const nameById = new Map((people ?? []).map((p) => [p.id, p.name || p.email || "Unnamed"]));

  return events.map((e) => {
    const holder = e.lead_id ? dispatcherByLead.get(e.lead_id) ?? null : null;
    return {
      eventId: e.id,
      dispatcherName: holder ? nameById.get(holder) ?? null : null,
      // Unclaimed counts as workable, matching what the policy allows.
      isMine: !holder || holder === profile.id,
    };
  });
}

/** The company's dispatcher commission rate, as a percentage. */
export async function getDispatcherCommissionRate(): Promise<number | null> {
  const profile = await getCurrentProfile();
  if (!profile || !isAdminRole(profile)) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from("company_profile")
    .select("dispatcher_commission_bp")
    .eq("company_id", profile.company_id)
    .maybeSingle<{ dispatcher_commission_bp: number }>();
  return (data?.dispatcher_commission_bp ?? 100) / 100;
}

/**
 * Sets the rate. Stored in basis points so a rate like 1.25% survives
 * without the rounding that a float percentage would introduce, the same
 * reason tax and deposit rates are stored that way.
 */
export async function setDispatcherCommissionRate(
  percent: number
): Promise<{ error?: string; ok?: boolean }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "Only Office or Admin can change this." };

  if (!Number.isFinite(percent) || percent < 0) return { error: "Enter a percentage of 0 or more." };
  // A dispatcher earning more than a fifth of the contract is far more
  // likely to be a typo than a deal.
  if (percent > 20) return { error: "That's over 20% — check the number before saving." };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("company_profile")
    .update({ dispatcher_commission_bp: Math.round(percent * 100) })
    .eq("company_id", profile.company_id)
    .select("company_id");
  if (error || !data?.length) return { error: error?.message || "Could not save." };

  revalidatePath("/commissions");
  revalidatePath("/settings/dispatcher-commission");
  return { ok: true };
}
