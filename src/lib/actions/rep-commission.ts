"use server";

import { clientName } from "@/lib/data/client-name";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { selectAll } from "@/lib/data/select-all";
import {
  closerPoolShareBp,
  computeRepCommission,
  isAdminRole,
  isStrictAdmin,
  costsForContract,
  unassignedJobCosts,
  paidTotalCents,
  commissionHolds,
  commissionQualifiedAt,
  type AppRole,
  type CommissionHold,
  type RepCommission,
} from "@/lib/data/types";
import {
  describeSalesTeamChange,
  salesTeamChanged,
  seatChangeError,
  type SalesTeamSnapshot,
} from "@/lib/data/sales-team-changes";
import { type PayoutKind } from "@/lib/data/commission-payouts";
import { addsToContractValue } from "@/lib/data/invoices";

export type SalesTeam = {
  sales_rep_1: string | null;
  sales_rep_1_bp: number;
  sales_rep_2: string | null;
  sales_rep_2_bp: number;
  /** The closer's own seat (0153). Their share comes off the pool
   *  first; the two rep shares split what is left. Contracts signed
   *  before 0153 carry their closer in sales_rep_2 instead, and these
   *  stay null/0 there. */
  closer_id: string | null;
  closer_pool_bp: number;
  commission_rate_bp: number;
  lead_cost_bp: number;
};

type EstimateRow = {
  id: string;
  doc_number: string;
  title: string;
  lead_id: string;
  total_cents: number;
  signed_at: string | null;
  status: string;
  kind: string | null;
  parent_estimate_id: string | null;
} & SalesTeam;

const TEAM_COLUMNS =
  "sales_rep_1, sales_rep_1_bp, sales_rep_2, sales_rep_2_bp, closer_id, closer_pool_bp, commission_rate_bp, lead_cost_bp";

/**
 * The sales team on one contract, with the company defaults filled in
 * where the contract has not been set up yet.
 *
 * The rate and lead cost are null until somebody saves the panel, which
 * is deliberately different from zero: a contract written before this
 * existed has not chosen a 0% rate, it has chosen nothing.
 */
export async function getSalesTeam(
  estimateId: string
): Promise<{ error?: string; team?: SalesTeam }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  const [{ data: est }, { data: settings }] = await Promise.all([
    supabase
      .from("estimates")
      .select(TEAM_COLUMNS + ", lead_id")
      .eq("id", estimateId)
      .eq("company_id", profile.company_id)
      .maybeSingle<SalesTeam & { lead_id: string }>(),
    supabase
      .from("company_profile")
      .select("sales_commission_bp, sales_lead_cost_bp, default_closer_bp")
      .eq("company_id", profile.company_id)
      .maybeSingle<{
        sales_commission_bp: number;
        sales_lead_cost_bp: number;
        default_closer_bp: number | null;
      }>(),
  ]);
  if (!est) return { error: "Contract not found." };

  const rateBp = est.commission_rate_bp ?? settings?.sales_commission_bp ?? 5000;

  // Falls back to whoever holds the lead, so the ordinary case needs
  // nobody to fill anything in. The closer follows only while the whole
  // team is unseeded: once anything is stamped (by the trigger at
  // signature, or by hand), the stored seats are the decision -- a
  // pre-0153 contract keeps its closer in seat two, and prefilling the
  // closer seat on top of that would show the same person paid twice.
  let repOne = est.sales_rep_1;
  let repTwo = est.sales_rep_2;
  let repOneBp = est.sales_rep_1_bp ?? 10000;
  let repTwoBp = est.sales_rep_2_bp ?? 0;
  let closerId = est.closer_id;
  let closerPoolBp = est.closer_pool_bp ?? 0;
  const unseeded = !est.sales_rep_1 && !est.sales_rep_2 && !est.closer_id;
  if (unseeded) {
    const { data: lead } = await supabase
      .from("leads")
      .select("assigned_to, partner_rep_id, closer_id, closer_bp")
      .eq("id", est.lead_id)
      .maybeSingle<{
        assigned_to: string | null;
        partner_rep_id: string | null;
        closer_id: string | null;
        closer_bp: number | null;
      }>();
    repOne = lead?.assigned_to ?? null;
    // The lead's partnership previews as the even split the trigger
    // will seed at signature (0163).
    if (lead?.partner_rep_id && lead.partner_rep_id !== lead.assigned_to) {
      repTwo = lead.partner_rep_id;
      repOneBp = 5000;
      repTwoBp = 5000;
    }
    closerId = lead?.closer_id ?? null;
    if (closerId) {
      // The same conversion the trigger will run at signature, so the
      // preview and the seeded figure cannot disagree.
      closerPoolBp = closerPoolShareBp(
        lead?.closer_bp ?? settings?.default_closer_bp ?? 500,
        rateBp
      );
    }
  }

  return {
    team: {
      sales_rep_1: repOne,
      sales_rep_1_bp: repOneBp,
      sales_rep_2: repTwo,
      sales_rep_2_bp: repTwoBp,
      closer_id: closerId,
      closer_pool_bp: closerPoolBp,
      commission_rate_bp: rateBp,
      lead_cost_bp: est.lead_cost_bp ?? settings?.sales_lead_cost_bp ?? 1500,
    },
  };
}

/**
 * Admin only. This decides what people are paid, so it is not something
 * a rep can edit on their own job.
 */
export async function saveSalesTeam(
  estimateId: string,
  team: SalesTeam
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) {
    return { error: "Only Office or Admin can set commission." };
  }

  const oneBp = Math.round(team.sales_rep_1_bp);
  const twoBp = team.sales_rep_2 ? Math.round(team.sales_rep_2_bp) : 0;
  // The split has to be the whole pot. Anything else quietly pays out
  // more or less than the commission that was calculated, and nobody
  // notices until payday.
  if (team.sales_rep_2 && oneBp + twoBp !== 10000) {
    return { error: "The two shares must add up to 100%." };
  }
  if (!team.sales_rep_2 && oneBp !== 10000) {
    return { error: "With one rep the share is 100%." };
  }
  if (team.sales_rep_2 && team.sales_rep_2 === team.sales_rep_1) {
    return { error: "That is the same person twice." };
  }

  // The closer's cut comes off the pool before the reps split it, so a
  // share past the whole pool would pay the reps out of nothing.
  const closerBp = team.closer_id ? Math.round(team.closer_pool_bp) : 0;
  if (closerBp < 0 || closerBp > 10000) {
    return { error: "The closer's share must be between 0 and 100% of the pool." };
  }
  if (team.closer_id && (team.closer_id === team.sales_rep_1 || team.closer_id === team.sales_rep_2)) {
    return { error: "The closer is already seated as a rep — one seat per person." };
  }

  const supabase = await createClient();
  // The row as it stands, so the audit trail below can hold both sides
  // and the seat gate can see what a save would actually move.
  const { data: current } = await supabase
    .from("estimates")
    .select(TEAM_COLUMNS + ", status")
    .eq("id", estimateId)
    .eq("company_id", profile.company_id)
    .maybeSingle<SalesTeamSnapshot & { status: string }>();

  const stored: SalesTeamSnapshot = {
    sales_rep_1: team.sales_rep_1 || null,
    sales_rep_1_bp: oneBp,
    sales_rep_2: team.sales_rep_2 || null,
    sales_rep_2_bp: twoBp,
    closer_id: team.closer_id || null,
    closer_pool_bp: closerBp,
    // Stamped here rather than read at report time, so changing the
    // company rate later cannot restate what has already been paid.
    commission_rate_bp: Math.round(team.commission_rate_bp),
    lead_cost_bp: Math.round(team.lead_cost_bp),
  };

  // Moving a seat to a different person on a signed contract restates
  // pay, and the document keeps naming whoever sold the job -- so that
  // move is the Admin's alone. Office keeps the shares and rates.
  if (current) {
    const held = seatChangeError({
      status: current.status,
      strictAdmin: isStrictAdmin(profile),
      before: current,
      after: stored,
    });
    if (held) return { error: held };
  }

  const { data, error } = await supabase
    .from("estimates")
    .update(stored)
    .eq("id", estimateId)
    .eq("company_id", profile.company_id)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "That contract couldn't be updated." };

  revalidatePath("/estimates");
  revalidatePath("/commissions");

  // Seats decide pay and the statement computes live from them, so a
  // swap with no record would restate history silently. One row per
  // save that changed anything (sales_team_changes, 0154), snapshots
  // as stored. If the row can't be written the save has already stood,
  // so the admin is told the history is short, not that saving failed.
  if (current && salesTeamChanged(current, stored)) {
    // The snapshot holds the eight team columns only -- status came
    // along for the seat gate and is not part of pay history.
    const { status: _status, ...oldTeam } = current;
    const { error: logError } = await supabase.from("sales_team_changes").insert({
      company_id: profile.company_id,
      estimate_id: estimateId,
      changed_by: profile.id,
      old_team: oldTeam,
      new_team: stored,
    });
    if (logError) {
      return {
        error: "The team was saved, but recording it in the change history failed: " + logError.message,
      };
    }
  }
  return {};
}

export type SalesTeamChangeRow = {
  id: string;
  changedAt: string;
  changedByName: string;
  lines: string[];
};

/**
 * The change history for one contract's sales team, newest first.
 * Gated like the save itself: this is pay history, not team info.
 */
export async function getSalesTeamChanges(
  estimateId: string
): Promise<{ error?: string; changes?: SalesTeamChangeRow[] }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "Only Office or Admin can read this." };

  const supabase = await createClient();
  const [changesRes, peopleRes] = await Promise.all([
    supabase
      .from("sales_team_changes")
      .select("id, changed_at, changed_by, old_team, new_team")
      .eq("company_id", profile.company_id)
      .eq("estimate_id", estimateId)
      .order("changed_at", { ascending: false })
      .returns<
        {
          id: string;
          changed_at: string;
          changed_by: string | null;
          old_team: SalesTeamSnapshot;
          new_team: SalesTeamSnapshot;
        }[]
      >(),
    // The whole roster, not just reps: a seat somebody held last year
    // must still resolve to their name (AGENTS.md).
    supabase
      .from("profiles")
      .select("id, name, email")
      .returns<{ id: string; name: string | null; email: string | null }[]>(),
  ]);
  if (changesRes.error) return { error: changesRes.error.message };

  const nameById = new Map(
    (peopleRes.data ?? []).map((p) => [p.id, p.name || p.email || "Unnamed"])
  );
  const repName = (id: string) => nameById.get(id) ?? "Unnamed";
  return {
    changes: (changesRes.data ?? []).map((c) => ({
      id: c.id,
      changedAt: c.changed_at,
      changedByName: c.changed_by ? (nameById.get(c.changed_by) ?? "Unnamed") : "system",
      lines: describeSalesTeamChange(c.old_team, c.new_team, repName),
    })),
  };
}

/**
 * The company's starting figures for a new contract.
 *
 * Only a starting point: each contract stamps its own rate when its sales
 * team is saved, and the panel there is where a particular job is
 * adjusted. Changing these cannot restate what has already been earned.
 */
export async function getSalesCommissionDefaults(): Promise<{
  sales_commission_bp: number;
  sales_lead_cost_bp: number;
}> {
  const profile = await getCurrentProfile();
  if (!profile) return { sales_commission_bp: 5000, sales_lead_cost_bp: 1500 };
  const supabase = await createClient();
  const { data } = await supabase
    .from("company_profile")
    .select("sales_commission_bp, sales_lead_cost_bp")
    .eq("company_id", profile.company_id)
    .maybeSingle<{ sales_commission_bp: number; sales_lead_cost_bp: number }>();
  return {
    sales_commission_bp: data?.sales_commission_bp ?? 5000,
    sales_lead_cost_bp: data?.sales_lead_cost_bp ?? 1500,
  };
}

export async function saveSalesCommissionDefaults(input: {
  commissionBp: number;
  leadCostBp: number;
}): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "Only Office or Admin can change this." };

  // A lead cost over 100% would make every job show a loss, and a
  // commission over 100% would pay out more than the job made. Neither is
  // a rate somebody meant to type.
  if (input.leadCostBp < 0 || input.leadCostBp > 10000) {
    return { error: "Lead cost must be between 0 and 100%." };
  }
  if (input.commissionBp < 0 || input.commissionBp > 10000) {
    return { error: "Commission must be between 0 and 100%." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_profile")
    .update({
      sales_commission_bp: Math.round(input.commissionBp),
      sales_lead_cost_bp: Math.round(input.leadCostBp),
    })
    .eq("company_id", profile.company_id)
    .select("company_id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Couldn't save those defaults." };

  revalidatePath("/settings/sales-commission");
  return {};
}

export type CommissionRep = { id: string; name: string; roles: AppRole[] };

/** Active members with their roles, for the salesperson and closer
 *  pickers -- roles included so callers can narrow to actual reps
 *  (repDropdownOptions) while still resolving any stored id to a name. */
export async function getCommissionReps(): Promise<CommissionRep[]> {
  const profile = await getCurrentProfile();
  if (!profile) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("company_members")
    .select("profile_id, status, roles, profiles(id, name, email)")
    .eq("company_id", profile.company_id)
    .eq("status", "Active")
    .returns<
      {
        roles: AppRole[] | null;
        profiles: { id: string; name: string | null; email: string | null } | null;
      }[]
    >();
  return (data ?? [])
    .filter(
      (r): r is { roles: AppRole[] | null; profiles: NonNullable<(typeof r)["profiles"]> } =>
        !!r.profiles
    )
    .map((r) => ({
      id: r.profiles.id,
      name: r.profiles.name || r.profiles.email || "Unnamed",
      roles: r.roles ?? [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type RepCommissionRow = {
  estimateId: string;
  docNumber: string;
  title: string;
  customerName: string;
  signedAt: string | null;
  repId: string;
  repName: string;
  /** This rep's share only, not the whole pot. */
  shareCents: number;
  collectedCents: number;
  collectedPct: number;
  certificateSigned: boolean;
  /** Empty when the job is finished and settled. */
  holds: CommissionHold[];
  /** The date it became payable, or null while anything is still held. */
  qualifiedAt: string | null;
  /** The share, once every hold is clear. Nil until then. */
  payableCents: number;
  detail: RepCommission;
  /** The customer's bills no contract claims (several contracts, bill
   *  filed to none) -- why a job with receipts still reads uncosted. */
  unassignedCosts: { count: number; cents: number };
  /** Only on the job asked for with detailFor: the one-job statement. */
  job?: JobCommissionDetail;
};

export type JobCommissionDetail = {
  leadId: string;
  certificateSignedAt: string | null;
  /** The bills this contract counts, newest first. */
  costLines: {
    id: string;
    spentOn: string;
    vendor: string;
    what: string | null;
    amountCents: number;
  }[];
  /** Customer money that counts as collected, oldest first. */
  payments: { paidAt: string | null; kind: string | null; method: string | null; amountCents: number }[];
};

/**
 * Every signed contract a rep is on, and what it earns them.
 *
 * A rep sees only their own lines. Enforced here rather than in the page,
 * because a page is a suggestion and an action is the boundary.
 */
export async function getRepCommissions(opts?: {
  /** Admins only; ignored for a rep, who always gets their own. */
  repId?: string;
  /** A contract id: its rows also carry the one-job breakdown. */
  detailFor?: string;
}): Promise<{
  error?: string;
  rows?: RepCommissionRow[];
  everyone?: boolean;
}> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const everyone = isStrictAdmin(profile) || isAdminRole(profile);
  const supabase = await createClient();

  const [estimates, settingsRes, membersRes] = await Promise.all([
    selectAll<EstimateRow>((from, to) =>
      supabase
        .from("estimates")
        .select(
          "id, doc_number, title, lead_id, total_cents, signed_at, status, kind, parent_estimate_id, " +
            TEAM_COLUMNS
        )
        .eq("company_id", profile.company_id)
        .eq("status", "Signed")
        .range(from, to)
    ),
    supabase
      .from("company_profile")
      .select("sales_commission_bp, sales_lead_cost_bp")
      .eq("company_id", profile.company_id)
      .maybeSingle<{ sales_commission_bp: number; sales_lead_cost_bp: number }>(),
    supabase
      .from("profiles")
      .select("id, name, email")
      .returns<{ id: string; name: string | null; email: string | null }[]>(),
  ]);

  const settings = settingsRes.data;
  const members = membersRes.data ?? [];

  const contracts = estimates.filter((e) => (e.kind ?? "contract") === "contract");
  if (contracts.length === 0) return { rows: [], everyone };

  const leadIds = [...new Set(contracts.map((c) => c.lead_id))];
  const [expenses, paid, leads, phases] = await Promise.all([
    selectAll<{
      id: string;
      lead_id: string;
      amount_cents: number;
      estimate_payment_id: string | null;
      vendor: string | null;
      vendor_id: string | null;
      description: string | null;
      category: string | null;
      spent_on: string;
    }>(
      (from, to) =>
        supabase
          .from("job_expenses")
          .select(
            "id, lead_id, amount_cents, estimate_payment_id, vendor, vendor_id, description, category, spent_on"
          )
          .eq("company_id", profile.company_id)
          .in("lead_id", leadIds)
          .range(from, to)
    ),
    selectAll<{
      estimate_id: string;
      amount_cents: number;
      status: "pending" | "succeeded" | "failed" | "cancelled";
      paid_at: string | null;
      kind: string | null;
      method: string | null;
    }>((from, to) =>
      supabase
        .from("portal_payments")
        .select("estimate_id, amount_cents, status, paid_at, kind, method")
        .eq("company_id", profile.company_id)
        .range(from, to)
    ),
    selectAll<{
      id: string;
      assigned_to: string | null;
      contact_type: string | null;
      first_name: string | null;
      last_name: string | null;
      company_name: string | null;
    }>((from, to) =>
      supabase
        .from("leads")
        .select("id, assigned_to, contact_type, first_name, last_name, company_name")
        .eq("company_id", profile.company_id)
        .in("id", leadIds)
        .range(from, to)
    ),
    selectAll<{ id: string; estimate_id: string }>((from, to) =>
      supabase
        .from("estimate_payments")
        .select("id, estimate_id")
        .eq("company_id", profile.company_id)
        .range(from, to)
    ),
  ]);

  const nameById = new Map(members.map((m) => [m.id, m.name || m.email || "Unnamed"]));
  // Vendor names only for the one-job statement's itemised bills.
  const vendorNameById = new Map<string, string>();
  if (opts?.detailFor) {
    const { data: vendorRows } = await supabase
      .from("vendors")
      .select("id, name")
      .eq("company_id", profile.company_id);
    for (const v of (vendorRows ?? []) as { id: string; name: string }[]) {
      vendorNameById.set(v.id, v.name);
    }
  }
  const assignedByLead = new Map(leads.map((l) => [l.id, l.assigned_to]));
  const customerByLead = new Map(
    leads.map((l) => [
      l.id,
      clientName(l) || "Customer",
    ])
  );
  const allPhaseIds = new Set(phases.map((p) => p.id));
  const contractsPerLead = new Map<string, number>();
  for (const c of contracts) {
    contractsPerLead.set(c.lead_id, (contractsPerLead.get(c.lead_id) ?? 0) + 1);
  }

  const rows: RepCommissionRow[] = [];
  for (const c of contracts) {
    // Change orders are extra work on the same job and belong in the same
    // calculation, so their value joins the contract's. The completion
    // certificate carries no money, and an invoice is a cost billed back
    // (a permit fee) -- not work sold -- so neither adds (owner's call:
    // an invoice never raises commission).
    const children = estimates.filter((e) => e.parent_estimate_id === c.id);
    const changeOrderCents = children
      .filter((e) => addsToContractValue(e))
      .reduce((s, e) => s + e.total_cents, 0);
    const contractCents = c.total_cents + changeOrderCents;

    const certificate = children.find((e) => e.kind === "completion") ?? null;
    const certificateSigned = certificate?.status === "Signed";

    // Attributed the same way the projects list does it. Summing the
    // lead's costs here would count one receipt against every contract
    // that customer holds -- five, on one of these leads -- and on this
    // report that is somebody's pay.
    // Not invoices: a paid permit fee must not count toward the contract
    // being paid off, or the hold below releases early.
    const docIds = new Set([c.id, ...children.filter((e) => e.kind !== "invoice").map((e) => e.id)]);
    const contractPhaseIds = new Set(
      phases.filter((p) => docIds.has(p.estimate_id)).map((p) => p.id)
    );
    const leadExpenses = expenses.filter((e) => e.lead_id === c.lead_id);
    const leadHasOneContract = (contractsPerLead.get(c.lead_id) ?? 1) === 1;
    const { cents: expensesCents, counted } = costsForContract({
      leadExpenses,
      contractPhaseIds,
      allPhaseIds,
      leadHasOneContract,
    });
    const unassignedCosts = unassignedJobCosts({
      leadExpenses,
      allPhaseIds,
      contractsOnLead: contractsPerLead.get(c.lead_id) ?? 1,
    });

    // Every document on the job, not just the contract. Change orders are
    // billed and paid against their own estimate id, so counting only the
    // contract's payments made a fully paid job with a change order read
    // as short -- and under the rule below, that is a commission the rep
    // never gets paid.
    const jobPayments = paid.filter((p) => docIds.has(p.estimate_id));
    const collectedCents = paidTotalCents(jobPayments);
    const lastPaymentAt =
      jobPayments
        .filter((p) => p.status === "succeeded" && p.paid_at)
        .map((p) => p.paid_at as string)
        .sort()
        .at(-1) ?? null;

    // The one-job statement's itemised lines. The same rule as
    // costsForContract, one bill at a time, so the list always adds up
    // to the costs figure above it.
    const job: JobCommissionDetail | undefined =
      opts?.detailFor === c.id
        ? {
            leadId: c.lead_id,
            certificateSignedAt: certificate?.signed_at ?? null,
            costLines: leadExpenses
              .filter(
                (e) =>
                  costsForContract({
                    leadExpenses: [e],
                    contractPhaseIds,
                    allPhaseIds,
                    leadHasOneContract,
                  }).counted > 0
              )
              .sort((a, b) => b.spent_on.localeCompare(a.spent_on))
              .map((e) => ({
                id: e.id,
                spentOn: e.spent_on,
                vendor: (e.vendor_id && vendorNameById.get(e.vendor_id)) || e.vendor || "—",
                what: e.description || e.category,
                amountCents: e.amount_cents,
              })),
            payments: jobPayments
              .filter((p) => p.status === "succeeded")
              .sort((a, b) => (a.paid_at ?? "").localeCompare(b.paid_at ?? ""))
              .map((p) => ({
                paidAt: p.paid_at,
                kind: p.kind,
                method: p.method,
                amountCents: p.amount_cents,
              })),
          }
        : undefined;

    const repOne = c.sales_rep_1 ?? assignedByLead.get(c.lead_id) ?? null;
    const detail = computeRepCommission({
      contractCents,
      leadCostBp: c.lead_cost_bp ?? settings?.sales_lead_cost_bp ?? 1500,
      commissionRateBp: c.commission_rate_bp ?? settings?.sales_commission_bp ?? 5000,
      expensesCents,
      hasCosts: counted > 0,
      rep1Bp: c.sales_rep_1_bp ?? 10000,
      rep2Bp: c.sales_rep_2 ? c.sales_rep_2_bp : 0,
      // Null on every pre-0153 contract, where the closer sits in seat
      // two and is already paid through rep2Bp above.
      closerPoolBp: c.closer_id ? (c.closer_pool_bp ?? 0) : 0,
    });

    // Earned when the job sells; paid when the job is finished and
    // settled. One number would either promise a rep money the company
    // has not received, or hide what they have already earned.
    const collectedPct = contractCents > 0 ? collectedCents / contractCents : 0;
    const holds = commissionHolds({
      hasCosts: counted > 0,
      collectedCents,
      contractCents,
      certificateSigned,
    });
    const qualifiedAt = commissionQualifiedAt({
      holds,
      lastPaymentAt,
      certificateSignedAt: certificate?.signed_at ?? null,
    });

    for (const [repId, shareCents] of [
      [repOne, detail.rep1Cents],
      [c.sales_rep_2, detail.rep2Cents],
      // The closer's own line, on the same report and under the same
      // holds -- their money clears when the job does, like everyone's.
      [c.closer_id, detail.closerCents],
    ] as [string | null, number][]) {
      if (!repId || shareCents <= 0) continue;
      if (!everyone && repId !== profile.id) continue;
      if (everyone && opts?.repId && repId !== opts.repId) continue;
      rows.push({
        estimateId: c.id,
        docNumber: c.doc_number,
        title: c.title,
        customerName: customerByLead.get(c.lead_id) ?? "Customer",
        signedAt: c.signed_at,
        repId,
        repName: nameById.get(repId) ?? "Unnamed",
        shareCents,
        collectedCents,
        collectedPct,
        certificateSigned,
        holds,
        qualifiedAt,
        // All or nothing. A part payment does not release a part of the
        // commission -- the rule is the job is done and paid for.
        payableCents: holds.length === 0 ? shareCents : 0,
        detail,
        unassignedCosts,
        job,
      });
    }
  }

  rows.sort((a, b) => (b.signedAt ?? "").localeCompare(a.signedAt ?? ""));
  return { rows, everyone };
}

// ── The payout ledger (0158): money actually handed to a rep ─────────

export type CommissionPayoutRow = {
  id: string;
  repId: string;
  repName: string;
  estimateId: string | null;
  /** Resolved for display; null when the payment wasn't tied to a job. */
  docNumber: string | null;
  jobTitle: string | null;
  amountCents: number;
  kind: PayoutKind;
  /** The day the money moved, YYYY-MM-DD. */
  paidOn: string;
  note: string | null;
};

type PayoutDbRow = {
  id: string;
  rep_id: string;
  estimate_id: string | null;
  amount_cents: number;
  kind: PayoutKind;
  paid_on: string;
  note: string | null;
};

/**
 * Every commission payment recorded, newest first. A rep sees their
 * own; Office/Admin see the company's -- the same boundary as the
 * commission report, enforced here and again by RLS.
 *
 * ledgerReady is false while migration 0158 hasn't been run yet, so
 * the page can keep showing earned/payable exactly as before instead
 * of erroring -- the owner runs SQL by hand, sometimes days later.
 */
export async function getCommissionPayouts(opts?: {
  /** Admins only; ignored for a rep, who always gets their own. */
  repId?: string;
}): Promise<{
  error?: string;
  payouts?: CommissionPayoutRow[];
  ledgerReady?: boolean;
  canRecord?: boolean;
}> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const everyone = isStrictAdmin(profile) || isAdminRole(profile);
  const canRecord = isAdminRole(profile);
  const supabase = await createClient();

  // Is 0158 in yet? Asked outright, because selectAll flattens a query
  // error into an empty list -- and a missing table must read as "not
  // set up", never as "no payments were ever made". Same posture as the
  // rollup fallbacks: degrade to the pre-ledger page, don't error.
  const probe = await supabase
    .from("rep_commission_payouts")
    .select("id")
    .eq("company_id", profile.company_id)
    .limit(1);
  if (probe.error) {
    return { payouts: [], ledgerReady: false, canRecord };
  }

  const raw = await selectAll<PayoutDbRow>((from, to) => {
    let q = supabase
      .from("rep_commission_payouts")
      .select("id, rep_id, estimate_id, amount_cents, kind, paid_on, note")
      .eq("company_id", profile.company_id)
      .order("paid_on", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, to);
    if (!everyone) q = q.eq("rep_id", profile.id);
    else if (opts?.repId) q = q.eq("rep_id", opts.repId);
    return q;
  });

  const estimateIds = [...new Set(raw.map((p) => p.estimate_id).filter((id): id is string => !!id))];
  const [peopleRes, jobsRes] = await Promise.all([
    // The whole roster, so a payment to somebody long archived still
    // carries their name (AGENTS.md).
    supabase
      .from("profiles")
      .select("id, name, email")
      .returns<{ id: string; name: string | null; email: string | null }[]>(),
    estimateIds.length
      ? supabase
          .from("estimates")
          .select("id, doc_number, title")
          .eq("company_id", profile.company_id)
          .in("id", estimateIds)
          .returns<{ id: string; doc_number: string; title: string | null }[]>()
      : Promise.resolve({ data: [] as { id: string; doc_number: string; title: string | null }[] }),
  ]);

  const nameById = new Map((peopleRes.data ?? []).map((p) => [p.id, p.name || p.email || "Unnamed"]));
  const jobById = new Map((jobsRes.data ?? []).map((j) => [j.id, j]));

  return {
    payouts: raw.map((p) => {
      const job = p.estimate_id ? jobById.get(p.estimate_id) : undefined;
      return {
        id: p.id,
        repId: p.rep_id,
        repName: nameById.get(p.rep_id) ?? "Unnamed",
        estimateId: p.estimate_id,
        docNumber: job?.doc_number ?? null,
        jobTitle: job?.title ?? null,
        amountCents: p.amount_cents,
        kind: p.kind,
        paidOn: p.paid_on,
        note: p.note,
      };
    }),
    ledgerReady: true,
    canRecord,
  };
}

/**
 * Record money handed to a rep: a commission payout, or an advance
 * given before the job settled. This decides what pay history says, so
 * it is Office/Admin -- the same people who hold the sales-team panel.
 *
 * Deliberately not idempotent: two identical cash advances in one week
 * are a real thing. recorded_by (kept by the table) is what makes
 * hand-entry safe to allow, same as manual customer payments.
 */
export async function recordCommissionPayout(input: {
  repId: string;
  amountCents: number;
  kind: PayoutKind;
  /** The day the money moved, YYYY-MM-DD. Today when omitted. */
  paidOn?: string;
  /** The job it was against, when there is one. */
  estimateId?: string | null;
  /** Cheque number, cash, Zelle -- whatever proves it later. */
  note?: string;
}): Promise<{ error?: string; ok?: boolean }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) {
    return { error: "Only Office or Admin can record a commission payment." };
  }

  const amountCents = Math.round(input.amountCents);
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return { error: "Enter an amount greater than zero." };
  }
  if (input.kind !== "payout" && input.kind !== "advance") {
    return { error: "Unknown payment type." };
  }
  if (input.paidOn && !/^\d{4}-\d{2}-\d{2}$/.test(input.paidOn)) {
    return { error: "Enter the date the money moved." };
  }

  const supabase = await createClient();

  // The rep must be on this company's roster -- any status: a rep who
  // left still gets their final commission. A wrong id would file pay
  // against nobody.
  const { data: member } = await supabase
    .from("company_members")
    .select("profile_id")
    .eq("company_id", profile.company_id)
    .eq("profile_id", input.repId)
    .maybeSingle();
  if (!member) return { error: "That person isn't on this company's roster." };

  // A job, if named, must be this company's -- otherwise a payment
  // could be filed against another company's contract.
  if (input.estimateId) {
    const { data: est } = await supabase
      .from("estimates")
      .select("id")
      .eq("id", input.estimateId)
      .eq("company_id", profile.company_id)
      .maybeSingle();
    if (!est) return { error: "That contract couldn't be found." };
  }

  const { data: inserted, error } = await supabase
    .from("rep_commission_payouts")
    .insert({
      company_id: profile.company_id,
      rep_id: input.repId,
      estimate_id: input.estimateId || null,
      amount_cents: amountCents,
      kind: input.kind,
      paid_on: input.paidOn || undefined,
      note: input.note?.trim() || null,
      recorded_by: profile.id,
    })
    .select("id");
  if (error || !inserted?.length) {
    // The one self-inflicted failure: 0158 hasn't been pasted yet.
    if (error?.message.includes("rep_commission_payouts")) {
      return {
        error:
          "Payment tracking isn't set up yet — paste supabase/migrations/0158_rep_commission_payouts.sql into the Supabase SQL editor (safe to run twice), then try again.",
      };
    }
    return { error: error?.message || "Could not record the payment." };
  }

  revalidatePath("/sales-commission");
  revalidatePath("/sales-commission/statement");
  return { ok: true };
}

/** Undo a mis-keyed entry. Amounts are never edited in place -- remove
 *  and re-record, the same discipline as manual customer payments. */
export async function removeCommissionPayout(
  payoutId: string
): Promise<{ error?: string; ok?: boolean }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "Only Office or Admin users can do that." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rep_commission_payouts")
    .delete()
    .eq("id", payoutId)
    .eq("company_id", profile.company_id)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "That payment couldn't be removed." };

  revalidatePath("/sales-commission");
  revalidatePath("/sales-commission/statement");
  return { ok: true };
}
