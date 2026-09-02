import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/data/select-all";
import { getCurrentProfile } from "@/lib/data/profile";
import {
  canManageBills,
  paidTotalCents,
  type Estimate,
  type EstimatePayment,
  type PortalPayment,
} from "@/lib/data/types";
import { CollectView, type ReceivableRow, type BillableRow } from "./collect-view";

export const dynamic = "force-dynamic";

type SlimLead = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  address: string | null;
  assigned_to: string | null;
};

/**
 * Money to Collect: outstanding receivables and the quiet gold beneath
 * them -- phases on signed contracts nobody has invoiced yet. Every
 * number is computed from the tables Projects and Payments already
 * read, so this page can never disagree with them.
 */
export default async function CollectPage() {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  if (!canManageBills(profile)) {
    return (
      <div className="empty-state">
        <p className="empty-label">You don&apos;t have access to receivables</p>
        <p className="empty-hint">
          Money to Collect is company-wide money — Bookkeeping, Office and Admin.
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  const companyId = profile.company_id;

  const [estimates, phases, paid, leads, members] = await Promise.all([
    selectAll<Estimate>((f, t) =>
      supabase.from("estimates").select("*").eq("company_id", companyId).range(f, t)
    ),
    selectAll<EstimatePayment>((f, t) =>
      supabase
        .from("estimate_payments")
        .select("id, estimate_id, sort_order, name, description, amount_cents, requested_at, due_date")
        .eq("company_id", companyId)
        .range(f, t)
    ),
    selectAll<PortalPayment>((f, t) =>
      supabase
        .from("portal_payments")
        .select("id, estimate_id, estimate_payment_id, kind, amount_cents, status, method, paid_at, created_at")
        .eq("company_id", companyId)
        .range(f, t)
    ),
    selectAll<SlimLead>((f, t) =>
      supabase
        .from("leads")
        .select("id, first_name, last_name, company_name, address, assigned_to")
        .eq("company_id", companyId)
        .range(f, t)
    ),
    supabase
      .from("company_members")
      .select("profile_id")
      .eq("company_id", companyId)
      .then(async ({ data: mem }) => {
        const ids = [...new Set((mem ?? []).map((m) => m.profile_id as string))];
        if (!ids.length) return [] as { id: string; name: string | null }[];
        const { data } = await supabase.from("profiles").select("id, name").in("id", ids);
        return (data ?? []) as { id: string; name: string | null }[];
      }),
  ]);

  const leadById = new Map(leads.map((l) => [l.id, l]));
  const repById = new Map(members.map((m) => [m.id, m.name]));
  // Phases live on contracts; a signed change order appends its phase to
  // the parent. Signed, un-voided contracts are the live book.
  const liveContracts = estimates.filter(
    (e) => (e.kind ?? "contract") === "contract" && e.status === "Signed"
  );
  const contractById = new Map(liveContracts.map((e) => [e.id, e]));

  const paidByPhase = new Map<string, number>();
  for (const p of paid) {
    if (!p.estimate_payment_id) continue;
    paidByPhase.set(
      p.estimate_payment_id,
      (paidByPhase.get(p.estimate_payment_id) ?? 0) + paidTotalCents([p])
    );
  }

  const label = (leadId: string) => {
    const l = leadById.get(leadId);
    return {
      customer:
        l?.company_name || [l?.first_name, l?.last_name].filter(Boolean).join(" ") || "Unnamed",
      address: l?.address ?? null,
      rep: l?.assigned_to ? (repById.get(l.assigned_to) ?? null) : null,
    };
  };

  const unpaid: ReceivableRow[] = [];
  const billable: BillableRow[] = [];
  for (const ph of phases) {
    const contract = contractById.get(ph.estimate_id);
    if (!contract) continue;
    const who = label(contract.lead_id);
    if (ph.requested_at) {
      const remaining = ph.amount_cents - (paidByPhase.get(ph.id) ?? 0);
      if (remaining <= 0) continue;
      unpaid.push({
        phaseId: ph.id,
        estimateId: contract.id,
        title: contract.title || contract.doc_number,
        phase: ph.name || `Phase ${ph.sort_order + 1}`,
        requestedAt: ph.requested_at,
        dueDate: ph.due_date ?? null,
        remainingCents: remaining,
        ...who,
      });
    } else {
      billable.push({
        phaseId: ph.id,
        estimateId: contract.id,
        title: contract.title || contract.doc_number,
        phase: ph.name || `Phase ${ph.sort_order + 1}`,
        amountCents: ph.amount_cents,
        ...who,
      });
    }
  }

  unpaid.sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  billable.sort((a, b) => a.customer.localeCompare(b.customer));

  return <CollectView unpaid={unpaid} billable={billable} />;
}
