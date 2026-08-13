"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { selectAll } from "@/lib/data/select-all";
import {
  computeRepCommission,
  isAdminRole,
  isStrictAdmin,
  costsForContract,
  paidTotalCents,
  commissionHolds,
  commissionQualifiedAt,
  type CommissionHold,
  type RepCommission,
} from "@/lib/data/types";

export type SalesTeam = {
  sales_rep_1: string | null;
  sales_rep_1_bp: number;
  sales_rep_2: string | null;
  sales_rep_2_bp: number;
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
  "sales_rep_1, sales_rep_1_bp, sales_rep_2, sales_rep_2_bp, commission_rate_bp, lead_cost_bp";

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
      .select("sales_commission_bp, sales_lead_cost_bp")
      .eq("company_id", profile.company_id)
      .maybeSingle<{ sales_commission_bp: number; sales_lead_cost_bp: number }>(),
  ]);
  if (!est) return { error: "Contract not found." };

  // Falls back to whoever holds the lead, so the ordinary one-rep case
  // needs nobody to fill anything in.
  let repOne = est.sales_rep_1;
  if (!repOne) {
    const { data: lead } = await supabase
      .from("leads")
      .select("assigned_to")
      .eq("id", est.lead_id)
      .maybeSingle<{ assigned_to: string | null }>();
    repOne = lead?.assigned_to ?? null;
  }

  return {
    team: {
      sales_rep_1: repOne,
      sales_rep_1_bp: est.sales_rep_1_bp ?? 10000,
      sales_rep_2: est.sales_rep_2,
      sales_rep_2_bp: est.sales_rep_2_bp ?? 0,
      commission_rate_bp: est.commission_rate_bp ?? settings?.sales_commission_bp ?? 5000,
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

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("estimates")
    .update({
      sales_rep_1: team.sales_rep_1 || null,
      sales_rep_1_bp: oneBp,
      sales_rep_2: team.sales_rep_2 || null,
      sales_rep_2_bp: twoBp,
      // Stamped here rather than read at report time, so changing the
      // company rate later cannot restate what has already been paid.
      commission_rate_bp: Math.round(team.commission_rate_bp),
      lead_cost_bp: Math.round(team.lead_cost_bp),
    })
    .eq("id", estimateId)
    .eq("company_id", profile.company_id)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "That contract couldn't be updated." };

  revalidatePath("/estimates");
  revalidatePath("/commissions");
  return {};
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

/** Active members, for the two salesperson pickers. */
export async function getCommissionReps(): Promise<{ id: string; name: string }[]> {
  const profile = await getCurrentProfile();
  if (!profile) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("company_members")
    .select("profile_id, status, profiles(id, name, email)")
    .eq("company_id", profile.company_id)
    .eq("status", "Active")
    .returns<{ profiles: { id: string; name: string | null; email: string | null } | null }[]>();
  return (data ?? [])
    .map((r) => r.profiles)
    .filter((p): p is { id: string; name: string | null; email: string | null } => !!p)
    .map((p) => ({ id: p.id, name: p.name || p.email || "Unnamed" }))
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
    selectAll<{ lead_id: string; amount_cents: number; estimate_payment_id: string | null }>(
      (from, to) =>
        supabase
          .from("job_expenses")
          .select("lead_id, amount_cents, estimate_payment_id")
          .eq("company_id", profile.company_id)
          .in("lead_id", leadIds)
          .range(from, to)
    ),
    selectAll<{
      estimate_id: string;
      amount_cents: number;
      status: "pending" | "succeeded" | "failed" | "cancelled";
      paid_at: string | null;
    }>((from, to) =>
      supabase
        .from("portal_payments")
        .select("estimate_id, amount_cents, status, paid_at")
        .eq("company_id", profile.company_id)
        .range(from, to)
    ),
    selectAll<{
      id: string;
      assigned_to: string | null;
      first_name: string | null;
      last_name: string | null;
      company_name: string | null;
    }>((from, to) =>
      supabase
        .from("leads")
        .select("id, assigned_to, first_name, last_name, company_name")
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
  const assignedByLead = new Map(leads.map((l) => [l.id, l.assigned_to]));
  const customerByLead = new Map(
    leads.map((l) => [
      l.id,
      [l.first_name, l.last_name].filter(Boolean).join(" ") || l.company_name || "Customer",
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
    // certificate is a child of the contract too but carries no money,
    // so it is excluded by kind rather than relying on its zero total.
    const children = estimates.filter((e) => e.parent_estimate_id === c.id);
    const changeOrderCents = children
      .filter((e) => e.status === "Signed" && (e.kind ?? "contract") !== "completion")
      .reduce((s, e) => s + e.total_cents, 0);
    const contractCents = c.total_cents + changeOrderCents;

    const certificate = children.find((e) => e.kind === "completion") ?? null;
    const certificateSigned = certificate?.status === "Signed";

    // Attributed the same way the projects list does it. Summing the
    // lead's costs here would count one receipt against every contract
    // that customer holds -- five, on one of these leads -- and on this
    // report that is somebody's pay.
    const docIds = new Set([c.id, ...children.map((e) => e.id)]);
    const contractPhaseIds = new Set(
      phases.filter((p) => docIds.has(p.estimate_id)).map((p) => p.id)
    );
    const { cents: expensesCents, counted } = costsForContract({
      leadExpenses: expenses.filter((e) => e.lead_id === c.lead_id),
      contractPhaseIds,
      allPhaseIds,
      leadHasOneContract: (contractsPerLead.get(c.lead_id) ?? 1) === 1,
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

    const repOne = c.sales_rep_1 ?? assignedByLead.get(c.lead_id) ?? null;
    const detail = computeRepCommission({
      contractCents,
      leadCostBp: c.lead_cost_bp ?? settings?.sales_lead_cost_bp ?? 1500,
      commissionRateBp: c.commission_rate_bp ?? settings?.sales_commission_bp ?? 5000,
      expensesCents,
      hasCosts: counted > 0,
      rep1Bp: c.sales_rep_1_bp ?? 10000,
      rep2Bp: c.sales_rep_2 ? c.sales_rep_2_bp : 0,
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
      });
    }
  }

  rows.sort((a, b) => (b.signedAt ?? "").localeCompare(a.signedAt ?? ""));
  return { rows, everyone };
}
