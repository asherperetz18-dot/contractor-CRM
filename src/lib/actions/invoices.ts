"use server";

import { clientName } from "@/lib/data/client-name";
import { revalidatePath } from "next/cache";
import { addDays } from "@/lib/company-clock";
import { companyToday } from "@/lib/data/company-today";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { selectAll } from "@/lib/data/select-all";
import {
  canCreateEstimates,
  lineTotalCents,
  paidTotalCents,
  vendorLabel,
  type EstimateStatus,
  type PortalPayment,
  type Vendor,
} from "@/lib/data/types";
import {
  billedCostIds,
  invoiceDraftError,
  invoiceEditError,
  invoiceEditTotals,
  invoiceTotalCents,
  type InvoiceEditLine,
  type InvoiceLineDraft,
} from "@/lib/data/invoices";
import { markProgressPaymentBilled, requestProgressPayment } from "@/lib/actions/progress-billing";
import type { BillChannel } from "@/lib/bill-email";

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
  customer: { name: string; phone: string | null; email: string | null };
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
    .select("id, contact_type, company_name, first_name, last_name, phone, email, second_contact_email")
    .eq("id", leadId)
    .eq("company_id", guard.companyId)
    .maybeSingle<{
      id: string;
      contact_type: string | null;
      company_name: string | null;
      first_name: string | null;
      last_name: string | null;
      phone: string | null;
      email: string | null;
      second_contact_email: string | null;
    }>();
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
        name: clientName(lead) || "Customer",
        phone: lead.phone,
        email: lead.email || lead.second_contact_email || null,
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
  /** "text", "email" or "both": send the customer the Pay link that way
   *  (DECISIONS #150). "marked": they were told another way. "draft": not
   *  issued yet -- saved to finish and send later (DECISIONS #149). */
  delivery: BillChannel | "marked" | "draft";
};

/**
 * Issues an invoice: numbers it, saves its lines, and bills it in one
 * go -- or saves it as a draft to finish and issue later.
 *
 * Issued means status Signed with one billed phase for the whole
 * amount. That is what every money screen reads as "owed", so Payments,
 * Money to Collect, the portal's Pay button, Record payment and Profit
 * & Loss all take it as they are. Its kind is what keeps it out of
 * sales totals and commission.
 */
export async function createInvoice(
  input: NewInvoiceInput
): Promise<{ error?: string; id?: string; docNumber?: string; sentTo?: string; warning?: string; draft?: boolean }> {
  const guard = await requireInvoicer();
  if ("error" in guard) return guard;

  const draft = input.delivery === "draft";
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

  // Invoices count on their own: INV-1001, INV-1002, ... (0205).
  const { data: numbered, error: numberError } = await supabase.rpc("next_invoice_number", { check_company_id: guard.companyId });
  if (numberError || !numbered) return { error: numberError?.message ?? "Couldn't number the invoice." };
  const docNumber = numbered as string;

  // The company's tax rate, for when the draft's lines are made taxable.
  const { data: settings } = await supabase
    .from("company_profile")
    .select("tax_rate_bp")
    .eq("company_id", guard.companyId)
    .maybeSingle<{ tax_rate_bp: number | null }>();

  // Issued means Signed (what every money screen reads as owed); a draft
  // waits as Draft. The approval gate, written for estimates, leaves
  // invoices alone either way (0205).
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
      status: (draft ? "Draft" : "Signed") as EstimateStatus,
      issued_at: draft ? null : now,
      sent_at: draft ? null : now,
      signed_at: draft ? null : now,
      payment_terms_days: dueInDays,
      // Whoever the contract names, so a sales-scoped rep who can see the
      // job can see what was billed on it.
      assigned_to: parent?.assigned_to ?? lead.assigned_to ?? guard.userId,
      job_address: parent?.job_address ?? null,
      // No line is taxable yet, so no tax; the rate is the company's, for
      // when one is made taxable on the draft.
      tax_rate_bp: draft ? (settings?.tax_rate_bp ?? 0) : 0,
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

  revalidatePath("/invoices");
  const delivery = input.delivery;
  if (delivery === "draft") return { id, docNumber, draft: true };

  revalidatePath("/projects");
  revalidatePath("/payments");
  revalidatePath("/collect");
  return { id, docNumber, ...(await billInvoice(phase[0].id, docNumber, dueInDays, delivery)) };
}

/**
 * Bills an issued invoice's one stage, due `termsDays` from the
 * company's today: texts the Pay link, or marks it billed for a customer
 * told some other way. A text that can't go out still leaves the
 * invoice billed -- it is real either way -- and says why.
 */
async function billInvoice(
  phaseId: string,
  docNumber: string,
  termsDays: number,
  delivery: BillChannel | "marked"
): Promise<{ error?: string; sentTo?: string; warning?: string }> {
  const due = addDays(await companyToday(), termsDays);
  if (delivery !== "marked") {
    const sent = await requestProgressPayment(phaseId, due, delivery);
    if (!sent.error) return { sentTo: sent.sentTo, warning: sent.warning };
    const marked = await markProgressPaymentBilled(phaseId, due);
    if (marked.error) return { error: marked.error };
    return { warning: `${docNumber} is issued, but nothing went out: ${sent.error}` };
  }
  const marked = await markProgressPaymentBilled(phaseId, due);
  return marked.error ? { error: marked.error } : {};
}

type DraftRow = {
  id: string;
  kind: string | null;
  status: EstimateStatus;
  lead_id: string;
  doc_number: string;
  total_cents: number;
  payment_terms_days: number | null;
};

/**
 * The one door to a draft invoice: this company's, an invoice, and still
 * a draft. An issued invoice is a record; a mistake on one is cancelled
 * and re-issued, never edited.
 */
async function loadDraftInvoice(
  supabase: Awaited<ReturnType<typeof createClient>>,
  companyId: string,
  invoiceId: string
): Promise<{ error: string } | { row: DraftRow }> {
  const { data: row } = await supabase
    .from("estimates")
    .select("id, kind, status, lead_id, doc_number, total_cents, payment_terms_days")
    .eq("id", invoiceId)
    .eq("company_id", companyId)
    .maybeSingle<DraftRow>();
  if (!row || row.kind !== "invoice") return { error: "Invoice not found." };
  if (row.status !== "Draft") return { error: "This invoice has already been issued. Cancel it and issue a new one to change it." };
  return { row };
}

export type InvoiceDraftInput = {
  title: string;
  lines: InvoiceEditLine[];
  /** Basis points: 725 is 7.25%. */
  taxRateBp: number;
  /** Days from issue until due; 0 is due on receipt. */
  termsDays: number;
  /** Printed on the invoice for the customer. */
  note: string;
};

/** Saves a draft invoice: its lines, tax, terms and note, and a total the bill matches. */
export async function saveInvoiceDraft(invoiceId: string, input: InvoiceDraftInput): Promise<{ error?: string; ok?: boolean }> {
  const guard = await requireInvoicer();
  if ("error" in guard) return guard;
  const supabase = await createClient();
  const loaded = await loadDraftInvoice(supabase, guard.companyId, invoiceId);
  if ("error" in loaded) return loaded;
  const { row } = loaded;

  const lines: InvoiceEditLine[] = input.lines.map((l) => ({
    name: l.name.trim(),
    description: l.description.trim(),
    quantity: Number(l.quantity),
    unitPriceCents: Math.round(Number(l.unitPriceCents)),
    taxable: !!l.taxable,
    sourceExpenseId: l.sourceExpenseId || null,
    showReceipt: !!l.sourceExpenseId && !!l.showReceipt,
  }));
  const problem = invoiceEditError(lines);
  if (problem) return { error: problem };
  const taxRateBp = Math.round(Number(input.taxRateBp));
  if (!Number.isFinite(taxRateBp) || taxRateBp < 0 || taxRateBp > 10000) return { error: "Enter a tax rate between 0% and 100%." };
  const termsDays = Math.round(Number(input.termsDays));
  if (!Number.isFinite(termsDays) || termsDays < 0 || termsDays > 365) return { error: "Choose when it's due." };

  // Costs billed back must be this job's, and not on another live invoice.
  const costIds = [...new Set(lines.map((l) => l.sourceExpenseId).filter((id): id is string => !!id))];
  if (costIds.length) {
    const { data: costs } = await supabase
      .from("job_expenses")
      .select("id")
      .eq("lead_id", row.lead_id)
      .eq("company_id", guard.companyId)
      .in("id", costIds);
    if ((costs ?? []).length !== costIds.length) return { error: "One of those costs isn't on this job." };
    const taken = (await billedLinks(createAdminClient(), guard.companyId, costIds)).find(
      (l) => l.status !== "Void" && l.doc_number !== row.doc_number
    );
    if (taken) return { error: `One of those costs is already billed on ${taken.doc_number}.` };
  }

  const totals = invoiceEditTotals(lines, taxRateBp);
  const title = input.title.trim() || "Invoice";
  const now = new Date().toISOString();

  const { error: removeError } = await supabase.from("estimate_items").delete().eq("estimate_id", row.id).eq("company_id", guard.companyId);
  if (removeError) return { error: removeError.message };
  const { error: itemsError } = await supabase.from("estimate_items").insert(
    lines.map((l, i) => ({
      company_id: guard.companyId,
      estimate_id: row.id,
      sort_order: i,
      name: l.name,
      description: l.description || null,
      quantity: l.quantity,
      unit_price_cents: l.unitPriceCents,
      line_total_cents: lineTotalCents(l.quantity, l.unitPriceCents),
      taxable: l.taxable,
      source_expense_id: l.sourceExpenseId,
      show_source_receipt: l.showReceipt,
    }))
  );
  if (itemsError) return { error: itemsError.message };

  const { error } = await supabase
    .from("estimates")
    .update({
      title,
      tax_rate_bp: taxRateBp,
      subtotal_cents: totals.subtotalCents,
      tax_cents: totals.taxCents,
      total_cents: totals.totalCents,
      payment_terms_days: termsDays,
      customer_message: input.note.trim() || null,
      updated_at: now,
    })
    .eq("id", row.id)
    .eq("company_id", guard.companyId)
    .eq("status", "Draft");
  if (error) return { error: error.message };

  // The invoice's one bill is its whole total, named as the text and
  // Payments call it.
  const { error: phaseError } = await supabase
    .from("estimate_payments")
    .update({ amount_cents: totals.totalCents, name: title, updated_at: now })
    .eq("estimate_id", row.id)
    .eq("company_id", guard.companyId);
  if (phaseError) return { error: phaseError.message };

  revalidatePath(`/estimates/${row.id}`);
  revalidatePath("/invoices");
  return { ok: true };
}

/** Issues a draft invoice: the customer is texted the Pay link, or it's marked billed. */
export async function issueInvoice(
  invoiceId: string,
  delivery: BillChannel | "marked"
): Promise<{ error?: string; sentTo?: string; warning?: string; issued?: boolean }> {
  const guard = await requireInvoicer();
  if ("error" in guard) return guard;
  const supabase = await createClient();
  const loaded = await loadDraftInvoice(supabase, guard.companyId, invoiceId);
  if ("error" in loaded) return loaded;
  const { row } = loaded;
  if (row.total_cents <= 0) return { error: "Add a line with a price before issuing it." };

  const { data: phase } = await supabase
    .from("estimate_payments")
    .select("id")
    .eq("estimate_id", row.id)
    .eq("company_id", guard.companyId)
    .order("sort_order")
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (!phase) return { error: "This draft has nothing to bill. Save it again and retry." };

  const now = new Date().toISOString();
  const { data: issued, error } = await supabase
    .from("estimates")
    .update({ status: "Signed" as EstimateStatus, issued_at: now, sent_at: now, signed_at: now, updated_at: now })
    .eq("id", row.id)
    .eq("company_id", guard.companyId)
    .eq("status", "Draft")
    .select("id");
  if (error) return { error: error.message };
  if (!issued?.length) return { error: "This invoice has already been issued." };

  revalidatePath(`/estimates/${row.id}`);
  revalidatePath("/invoices");
  revalidatePath("/projects");
  revalidatePath("/payments");
  revalidatePath("/collect");
  // Issued from here on, whatever the text does: the caller must say so.
  return { issued: true, ...(await billInvoice(phase.id, row.doc_number, row.payment_terms_days ?? 0, delivery)) };
}

/** Deletes a draft invoice nobody was ever sent. */
export async function deleteInvoiceDraft(invoiceId: string): Promise<{ error?: string; ok?: boolean }> {
  const guard = await requireInvoicer();
  if ("error" in guard) return guard;
  const supabase = await createClient();
  const loaded = await loadDraftInvoice(supabase, guard.companyId, invoiceId);
  if ("error" in loaded) return loaded;

  // The service role, because deleting is Office/Admin under RLS and
  // anyone who can invoice can start a draft. Still only this company's
  // draft invoice; its lines and bill go with it.
  const { error } = await createAdminClient()
    .from("estimates")
    .delete()
    .eq("id", loaded.row.id)
    .eq("company_id", guard.companyId)
    .eq("kind", "invoice")
    .eq("status", "Draft");
  if (error) return { error: error.message };
  revalidatePath("/invoices");
  revalidatePath("/estimates");
  return { ok: true };
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
  if (invoice.status === "Draft") return { error: "This is still a draft: delete it instead." };

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
  revalidatePath("/invoices");
  revalidatePath("/projects");
  revalidatePath("/payments");
  revalidatePath("/collect");
  return { ok: true };
}
