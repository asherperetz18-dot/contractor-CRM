import { clientName } from "@/lib/data/client-name";
import { createClient } from "@/lib/supabase/server";
import { collectsOnDocument } from "@/lib/data/invoices";
import { selectAll } from "@/lib/data/select-all";
import { getCurrentProfile } from "@/lib/data/profile";
import { getRoleNamesCached } from "@/lib/data/company-chrome";
import { companyToday } from "@/lib/data/company-today";
import { roleName } from "@/lib/role-names";
import { canViewFinancials } from "@/lib/data/accounting-access";
import { inStatusGroup } from "@/lib/data/invoice-rows";
import { loadInvoiceLeads, loadInvoiceRows } from "@/lib/data/load-invoice-rows";
import type { EstimatePayment } from "@/lib/data/types";
import { CollectView, type ReceivableRow, type BillableRow } from "./collect-view";

export const dynamic = "force-dynamic";

/**
 * Money to Collect: outstanding receivables and the quiet gold beneath
 * them -- phases on signed contracts nobody has invoiced yet. The
 * outstanding side is the open part of the Invoices page's rows
 * (DECISIONS #148), read by the same loader, so the two pages can never
 * disagree; it is aged by due date.
 */
export default async function CollectPage() {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  // Was canManageBills (role only). canViewFinancials is that same role
  // check plus the View Financials switch, so this only ever widens who
  // gets in -- Bookkeeping, Office and Admin are unaffected.
  if (!canViewFinancials(profile)) {
    // The role as this company names it (DECISIONS #138).
    const bookkeeping = roleName(await getRoleNamesCached(profile.company_id), "Bookkeeping");
    return (
      <div className="empty-state">
        <p className="empty-label">You don&apos;t have access to receivables</p>
        <p className="empty-hint">
          Money to Collect is company-wide money — {bookkeeping}, Office and Admin, or
          anyone switched on under Settings › Users &amp; Roles › View Financials.
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  const companyId = profile.company_id;
  const today = await companyToday();

  const [{ rows, docs, leadById, financed }, unbilled, members] = await Promise.all([
    loadInvoiceRows(supabase, companyId, today),
    // Stages nobody has billed yet, for Billable Now.
    selectAll<Pick<EstimatePayment, "id" | "estimate_id" | "sort_order" | "name" | "amount_cents">>((f, t) =>
      supabase
        .from("estimate_payments")
        .select("id, estimate_id, sort_order, name, amount_cents")
        .eq("company_id", companyId)
        .is("requested_at", null)
        .is("cancelled_at", null)
        .order("id")
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

  // Billable Now is unbilled stages on signed contracts and issued
  // invoices -- not a change order's own, whose amount the contract
  // already carries as one line, and not a contract paying with
  // financing, whose lender pays it (DECISIONS #166, #167).
  const contractById = new Map(docs.filter((e) => collectsOnDocument(e)).map((e) => [e.id, e]));
  const billableStages = unbilled.filter((ph) => contractById.has(ph.estimate_id) && !financed.has(ph.estimate_id));
  // Only the customers these rows name -- not the company's whole
  // contact book (same cure as Estimates, #019/#020).
  const missing = billableStages
    .map((ph) => contractById.get(ph.estimate_id)!.lead_id)
    .filter((id) => !leadById.has(id));
  for (const l of await loadInvoiceLeads(supabase, companyId, missing)) leadById.set(l.id, l);

  const repById = new Map(members.map((m) => [m.id, m.name]));
  const label = (leadId: string) => {
    const l = leadById.get(leadId);
    return {
      customer: clientName(l) || "Unnamed",
      address: l?.address ?? null,
      rep: l?.assigned_to ? (repById.get(l.assigned_to) ?? null) : null,
    };
  };

  // Still owed: everything open with money left on it -- a contract's
  // stage, a change order's or an invoice.
  const unpaid: ReceivableRow[] = rows
    .filter((r) => inStatusGroup(r.status, "open") && r.owedCents > 0)
    .map((r) => ({
      phaseId: r.id,
      estimateId: r.docId,
      leadId: r.leadId,
      title: r.title,
      phase: r.stage ?? "Invoice",
      requestedAt: r.billedAt,
      dueDate: r.dueDate,
      remainingCents: r.owedCents,
      financedBy: r.financedBy ?? null,
      ...label(r.leadId),
    }));

  const billable: BillableRow[] = billableStages.map((ph) => {
    const contract = contractById.get(ph.estimate_id)!;
    return {
      phaseId: ph.id,
      estimateId: contract.id,
      leadId: contract.lead_id,
      title: contract.title || contract.doc_number,
      phase: ph.name || `Phase ${ph.sort_order + 1}`,
      amountCents: ph.amount_cents,
      ...label(contract.lead_id),
    };
  });

  // Most overdue first: by due date, a bill with none after those with
  // one, and those the lender pays after all of them.
  unpaid.sort(
    (a, b) =>
      Number(!!a.financedBy) - Number(!!b.financedBy) ||
      (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
      a.requestedAt.localeCompare(b.requestedAt)
  );
  billable.sort((a, b) => a.customer.localeCompare(b.customer));

  return <CollectView unpaid={unpaid} billable={billable} today={today} />;
}
