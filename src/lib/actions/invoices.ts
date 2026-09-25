"use server";

import { revalidatePath } from "next/cache";
import { addDays } from "@/lib/company-clock";
import { companyToday } from "@/lib/data/company-today";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { selectAll } from "@/lib/data/select-all";
import {
  canCreateEstimates,
  paidTotalCents,
  vendorLabel,
  type EstimateStatus,
  type PortalPayment,
  type Vendor,
} from "@/lib/data/types";
import {
  billedCostIds,
  invoiceDocNumber,
  invoiceDraftError,
  invoiceTotalCents,
  type InvoiceLineDraft,
} from "@/lib/data/invoices";
import { markProgressPaymentBilled, requestProgressPayment } from "@/lib/actions/progress-billing";

/**
 * Billing a customer is an estimate-editing act, gated the way billing
 * a contract phase is (`requireBiller` in progress-billing): Office,
 * Admin, Production and anyone given Create Estimates. Never Field.
 */
async function requireInvoicer(): Promise<
  { error: string } | { companyId: string; userId: string }
> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canCreateEstimates(profile)) return { error: "You don't have permission to invoice customers." };
  return { companyId: profile.company_id, userId: profile.id };
}

/** The live invoice lines that bill a cost back, when 0180 has run. */
async function billedLinks(
  admin: ReturnType<typeof createAdminClient>,
  companyId: string,
  expenseIds: string[]
): Promise<{ source_expense_id: string; doc_number: string; status: string }[]> {
  if (expenseIds.length === 0) return [];
  const { data, error } = await admin
    .from("estimate_items")
    .select("source_expense_id, estimates!inner ( doc_number, status, kind )")
    .eq("company_id", companyId)
    .in("source_expense_id", expenseIds)
    .returns<
      {
        source_expense_id: string;
        estimates: { doc_number: string; status: string; kind: string | null } | null;
      }[]
    >();
  // Before migration 0180 the column doesn't exist: nothing is linked yet.
  if (error || !data) return [];
  return data
    .filter((r) => r.estimates?.kind === "invoice")
    .map((r) => ({
      source_expense_id: r.source_expense_id,
      doc_number: r.estimates!.doc_number,
      status: r.estimates!.status,
    }));
}

export type InvoiceCostOption = {
  id: string;
  label: string;
  description: string | null;
  category: string | null;
  vendorName: string | null;
  amountCents: number;
  spentOn: string;
  hasReceipt: boolean;
  /** The invoice it's already on, when it has been billed. */
  billedOn: string | null;
};

export type InvoiceSetup = {
  customer: { name: string; phone: string | null };
  contracts: { id: string; label: string }[];
  costs: InvoiceCostOption[];
};

/**
 * What the New invoice window needs for one customer: their signed
 * contracts (to pick which one the invoice is for) and the job's paid
 * costs, each marked when it's already been billed.
 */
export async function getInvoiceSetup(leadId: string): Promise<{ error?: string; setup?: InvoiceSetup }> {
  const guard = await requireInvoicer();
  if ("error" in guard) return guard;

  const supabase = await createClient();
  const { data: lead } = await supabase
    .from("leads")
    .select("id, first_name, last_name, phone")
    .eq("id", leadId)
    .eq("company_id", guard.companyId)
    .maybeSingle<{ id: string; first_name: string | null; last_name: string | null; phone: string | null }>();
  if (!lead) return { error: "Customer not found." };

  const [{ data: contracts }, costs, { data: vendors }] = await Promise.all([
    supabase
      .from("estimates")
      .select("id, doc_number, title")
      .eq("lead_id", leadId)
      .eq("company_id", guard.companyId)
      .eq("kind", "contract")
      .eq("status", "Signed")
      .order("signed_at", { ascending: false })
      .returns<{ id: string; doc_number: string; title: string | null }[]>(),
    selectAll<{
      id: string;
      description: string | null;
      category: string | null;
      vendor: string | null;
      vendor_id: string | null;
      amount_cents: number;
      spent_on: string;
      receipt_url: string | null;
    }>((from, to) =>
      supabase
        .from("job_expenses")
        .select("id, description, category, vendor, vendor_id, amount_cents, spent_on, receipt_url")
        .eq("lead_id", leadId)
        .eq("company_id", guard.companyId)
        .order("spent_on", { ascending: false })
        .range(from, to)
    ),
    supabase.from("vendors").select("*").eq("company_id", guard.companyId).returns<Vendor[]>(),
  ]);

  const links = await billedLinks(
    createAdminClient(),
    guard.companyId,
    costs.map((c) => c.id)
  );
  const live = billedCostIds(links);
  const vendorById = new Map((vendors ?? []).map((v) => [v.id, v]));

  return {
    setup: {
      customer: {
        name: [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim() || "Customer",
        phone: lead.phone,
      },
      contracts: (contracts ?? []).map((c) => ({
        id: c.id,
        label: [c.doc_number, c.title].filter(Boolean).join(" · "),
      })),
      costs: costs.map((c) => {
        const vendor = c.vendor_id ? vendorById.get(c.vendor_id) : null;
        const vendorName = vendor ? vendorLabel(vendor) : c.vendor;
        return {
          id: c.id,
          label: c.description || c.category || vendorName || "Cost",
          description: c.description,
          category: c.category,
          vendorName,
          amountCents: c.amount_cents,
          spentOn: c.spent_on,
          hasReceipt: !!c.receipt_url,
          billedOn: live.has(c.id)
            ? (links.find((l) => l.source_expense_id === c.id && l.status !== "Void")?.doc_number ?? null)
            : null,
        };
      }),
    },
  };
}

export type NewInvoiceInput = {
  leadId: string;
  /** The signed contract it's for. Null: a customer with no contract. */
  parentEstimateId: string | null;
  title: string;
  lines: InvoiceLineDraft[];
  /** Days from today until it's due; 0 is due on receipt. */
  dueInDays: number;
  /** "text": text the customer a Pay link. "marked": they were told
   *  another way (handed over, emailed from the office). */
  delivery: "text" | "marked";
};

/**
 * Issues an invoice: numbers it, saves its lines, and bills it in one
 * go -- an invoice has nothing to agree to, so there is no draft stage
 * a customer could be waiting on.
 *
 * Issued means status Signed with one billed phase for the whole
 * amount. That is what every money screen reads as "owed", so Payments,
 * Money to Collect, the portal's Pay button, Record payment and Profit
 * & Loss all take it as they are. Its kind is what keeps it out of
 * sales totals and commission.
 */
export async function createInvoice(
  input: NewInvoiceInput
): Promise<{ error?: string; id?: string; docNumber?: string; sentTo?: string; warning?: string }> {
  const guard = await requireInvoicer();
  if ("error" in guard) return guard;

  const lines = input.lines.map((l) => ({
    ...l,
    name: l.name.trim(),
    description: l.description.trim(),
    amountCents: Math.round(Number(l.amountCents)),
  }));
  const draftError = invoiceDraftError(lines);
  if (draftError) return { error: draftError };
  const total = invoiceTotalCents(lines);
  const dueInDays = Math.max(0, Math.min(365, Math.round(Number(input.dueInDays) || 0)));

  const supabase = await createClient();
  const admin = createAdminClient();

  const { data: lead } = await supabase
    .from("leads")
    .select("id, assigned_to, address")
    .eq("id", input.leadId)
    .eq("company_id", guard.companyId)
    .maybeSingle<{ id: string; assigned_to: string | null; address: string | null }>();
  if (!lead) return { error: "Customer not found." };

  let parent: { id: string; assigned_to: string | null; job_address: string | null; title: string | null } | null =
    null;
  if (input.parentEstimateId) {
    const { data } = await supabase
      .from("estimates")
      .select("id, lead_id, kind, status, assigned_to, job_address, title")
      .eq("id", input.parentEstimateId)
      .eq("company_id", guard.companyId)
      .maybeSingle<{
        id: string;
        lead_id: string;
        kind: string | null;
        status: EstimateStatus;
        assigned_to: string | null;
        job_address: string | null;
        title: string | null;
      }>();
    if (!data || data.lead_id !== lead.id) return { error: "That contract isn't this customer's." };
    if ((data.kind ?? "contract") !== "contract" || data.status !== "Signed") {
      return { error: "An invoice can only be added to a signed contract." };
    }
    parent = data;
  }

  // Costs billed back must be this job's, and not already on an invoice.
  const costIds = [...new Set(lines.map((l) => l.sourceExpenseId).filter((id): id is string => !!id))];
  if (costIds.length) {
    const { data: costs } = await supabase
      .from("job_expenses")
      .select("id")
      .eq("lead_id", lead.id)
      .eq("company_id", guard.companyId)
      .in("id", costIds);
    if ((costs ?? []).length !== costIds.length) return { error: "One of those costs isn't on this job." };
    const links = await billedLinks(admin, guard.companyId, costIds);
    const taken = links.find((l) => l.status !== "Void");
    if (taken) return { error: `One of those costs is already billed on ${taken.doc_number}.` };
  }

  const { data: sequenced, error: numberError } = await supabase.rpc("next_estimate_number", {
    check_company_id: guard.companyId,
  });
  if (numberError || !sequenced) return { error: numberError?.message ?? "Couldn't number the invoice." };
  const docNumber = invoiceDocNumber(sequenced as string);

  // Inserted already issued (Signed). An invoice has nothing to agree to
  // and nothing for the estimate-approval gate to hold -- that gate
  // (0136) fires on leaving Draft, so a Draft-then-update would trip it.
  const now = new Date().toISOString();
  const title = input.title.trim() || (parent?.title ? `Extras on ${parent.title}` : "Invoice");
  const { data: created, error } = await supabase
    .from("estimates")
    .insert({
      company_id: guard.companyId,
      lead_id: lead.id,
      parent_estimate_id: parent?.id ?? null,
      kind: "invoice",
      doc_number: docNumber,
      title,
      status: "Signed" as EstimateStatus,
      issued_at: now,
      sent_at: now,
      signed_at: now,
      // Whoever the contract names, so a sales-scoped rep who can see the
      // job can see what was billed on it.
      assigned_to: parent?.assigned_to ?? lead.assigned_to ?? guard.userId,
      job_address: parent?.job_address ?? null,
      tax_rate_bp: 0,
      subtotal_cents: total,
      tax_cents: 0,
      total_cents: total,
      // An invoice is owed in full; there is no deposit to take first.
      deposit_percent_bp: 0,
      deposit_cap_cents: 0,
      deposit_cents: 0,
      created_by: guard.userId,
    })
    .select("id")
    .returns<{ id: string }[]>();
  if (error) return { error: error.message };
  const id = created?.[0]?.id;
  if (!id) return { error: "Couldn't create the invoice." };

  const itemRows = lines.map((l, i) => ({
    company_id: guard.companyId,
    estimate_id: id,
    sort_order: i,
    name: l.name,
    description: l.description || null,
    quantity: 1,
    unit_price_cents: l.amountCents,
    line_total_cents: l.amountCents,
    taxable: false,
    source_expense_id: l.sourceExpenseId,
    show_source_receipt: l.showReceipt,
  }));
  let { error: itemsError } = await supabase.from("estimate_items").insert(itemRows);
  if (itemsError && /source_expense_id|show_source_receipt/.test(itemsError.message)) {
    // Migration 0180 not run yet: the lines still save, just unlinked.
    ({ error: itemsError } = await supabase
      .from("estimate_items")
      .insert(itemRows.map(({ source_expense_id: _s, show_source_receipt: _r, ...rest }) => rest)));
  }
  const { data: phase, error: phaseError } = itemsError
    ? { data: null, error: itemsError }
    : await supabase
        .from("estimate_payments")
        .insert({
          company_id: guard.companyId,
          estimate_id: id,
          sort_order: 0,
          // What the text and Payments call it: "Permit fees on INV-1042
          // is due Sep 25 - $447.50".
          name: title,
          amount_cents: total,
        })
        .select("id")
        .returns<{ id: string }[]>();
  if (phaseError || !phase?.[0]) {
    // Half an invoice is worse than none: take it back out. The service
    // role, because deleting is Office/Admin under RLS and Production
    // can issue invoices too.
    await admin.from("estimates").delete().eq("id", id).eq("company_id", guard.companyId);
    return { error: phaseError?.message ?? "Couldn't save the invoice." };
  }

  const due = addDays(await companyToday(), dueInDays);
  revalidatePath("/projects");
  revalidatePath("/payments");
  revalidatePath("/collect");

  if (input.delivery === "text") {
    const sent = await requestProgressPayment(phase[0].id, due);
    if (!sent.error) return { id, docNumber, sentTo: sent.sentTo };
    // The invoice is real either way. Bill it without the text so it is
    // owed and on the portal, and say why the text didn't go.
    const marked = await markProgressPaymentBilled(phase[0].id, due);
    if (marked.error) return { error: marked.error, id, docNumber };
    return {
      id,
      docNumber,
      warning: `${docNumber} is issued, but the text didn't go out: ${sent.error}`,
    };
  }

  const marked = await markProgressPaymentBilled(phase[0].id, due);
  if (marked.error) return { error: marked.error, id, docNumber };
  return { id, docNumber };
}

/**
 * Cancels an invoice sent by mistake. Only while nothing has been paid
 * or is clearing on it -- money that arrived needs a refund, not a
 * cancelled invoice. The record stays (Void), and the costs on it are
 * free to be billed again.
 */
export async function cancelInvoice(
  invoiceId: string,
  reason: string
): Promise<{ error?: string; ok?: boolean }> {
  const guard = await requireInvoicer();
  if ("error" in guard) return guard;
  if (!reason.trim()) return { error: "Say why it's cancelled — that's what answers the question later." };

  const supabase = await createClient();
  const { data: invoice } = await supabase
    .from("estimates")
    .select("id, kind, status, lead_id")
    .eq("id", invoiceId)
    .eq("company_id", guard.companyId)
    .maybeSingle<{ id: string; kind: string | null; status: EstimateStatus; lead_id: string }>();
  if (!invoice || invoice.kind !== "invoice") return { error: "Invoice not found." };
  if (invoice.status === "Void") return { error: "That invoice is already cancelled." };

  const { data: payments } = await createAdminClient()
    .from("portal_payments")
    .select("status, amount_cents")
    .eq("estimate_id", invoiceId)
    .returns<Pick<PortalPayment, "status" | "amount_cents">[]>();
  if (paidTotalCents(payments ?? []) > 0 || (payments ?? []).some((p) => p.status === "pending")) {
    return { error: "Money has come in on this invoice, so it can't be cancelled. Remove or refund the payment first." };
  }

  const now = new Date().toISOString();
  const { data: updated, error } = await supabase
    .from("estimates")
    .update({ status: "Void", voided_at: now, voided_by: guard.userId, void_reason: reason.trim() })
    .eq("id", invoiceId)
    .eq("company_id", guard.companyId)
    .select("id");
  if (error) return { error: error.message };
  if (!updated?.length) return { error: "That invoice couldn't be cancelled." };

  // Nothing is owed on it any more: off the receivables and the portal.
  await supabase
    .from("estimate_payments")
    .update({ cancelled_at: now, requested_at: null, due_date: null, updated_at: now })
    .eq("estimate_id", invoiceId)
    .eq("company_id", guard.companyId);

  revalidatePath(`/estimates/${invoiceId}`);
  revalidatePath("/projects");
  revalidatePath("/payments");
  revalidatePath("/collect");
  return { ok: true };
}
