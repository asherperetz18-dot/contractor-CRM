"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
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

  const admin = createAdminClient();
  const { data: lead } = await admin
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

  // Claiming is an update on the lead, and the update policy still
  // admits only Office and Sales. The permission rules above already
  // decided this is allowed, so the write goes through the service role.
  const supabase = createAdminClient();
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
    .select("id, lead_id, total_cents")
    .eq("company_id", profile.company_id)
    .eq("status", "Signed")
    .returns<{ id: string; lead_id: string; total_cents: number }[]>();
  if (!signed?.length) return { rows: [], ratePercent: bp / 100 };

  const leadIds = [...new Set(signed.map((e) => e.lead_id))];
  const { data: leads } = await admin
    .from("leads")
    .select("id, dispatcher_id")
    .in("id", leadIds)
    .not("dispatcher_id", "is", null)
    .returns<{ id: string; dispatcher_id: string }[]>();
  const dispatcherByLead = new Map((leads ?? []).map((l) => [l.id, l.dispatcher_id]));

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
    computed.map((c) => [c.dispatcherId, { ...c, dispatcherName: "Unknown" }])
  );

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
