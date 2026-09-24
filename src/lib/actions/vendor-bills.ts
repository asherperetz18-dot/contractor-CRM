"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { selectAll } from "@/lib/data/select-all";
import { billRemainingCents, canManageBills, canManageCosts } from "@/lib/data/types";
import {
  BILL_PAYMENT_METHODS,
  billPaymentMethodLabel,
  planBillPayments,
  type BillPaymentLine,
  type OpenJobBill,
} from "@/lib/data/bills";
import { phaseIsOnJob } from "@/lib/data/job-phase-check";
import {
  RECEIPT_BUCKET,
  confirmReceiptUpload,
  receiptPathBelongs,
  type UploadedReceipt,
} from "@/lib/receipts";

export type BillInput = {
  vendorId?: string | null;
  vendorName?: string | null;
  leadId?: string | null;
  /** The phase of the job the bill is filed to. Leave undefined to keep
   *  whatever the row has (the edit dialog doesn't show phases). */
  estimatePaymentId?: string | null;
  reference?: string | null;
  amountCents: number;
  billDate?: string | null;
  dueDate?: string | null;
  scheduledDate?: string | null;
  notes?: string | null;
  /** The already-uploaded receipt file, when one was attached. */
  receipt?: UploadedReceipt | null;
};

const isDay = (s?: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * PostgREST's "Could not find the 'receipt_url' column of 'vendor_bills'
 * in the schema cache" means migration 0123 hasn't been run. Said in
 * plain words, with the file to run, instead of a sentence about caches.
 */
function plainDbError(message: string): string {
  if (/schema cache/i.test(message) && /(receipt_url|receipt_path|estimate_payment_id)/.test(message)) {
    return (
      "The database needs one update first: run supabase/migrations/0123_vendor_bill_receipts.sql " +
      "in the Supabase SQL editor, then try again. Until then a bill can't carry a receipt or a phase."
    );
  }
  return message;
}

function cleanBill(profileCompany: string, input: BillInput) {
  const amount = Math.round(Number(input.amountCents) || 0);
  if (amount <= 0) return { error: "Enter the bill amount." as const };
  if (!input.vendorId && !input.vendorName?.trim()) {
    return { error: "Name the vendor." as const };
  }
  return {
    row: {
      company_id: profileCompany,
      vendor_id: input.vendorId || null,
      // One name per supplier: free text only when no record was picked.
      vendor_name: input.vendorId ? null : input.vendorName?.trim() || null,
      lead_id: input.leadId || null,
      reference: input.reference?.trim() || null,
      amount_cents: amount,
      bill_date: isDay(input.billDate) ? input.billDate : null,
      due_date: isDay(input.dueDate) ? input.dueDate : null,
      scheduled_date: isDay(input.scheduledDate) ? input.scheduledDate : null,
      notes: input.notes?.trim() || null,
      // Only written when a phase was actually given, so the column is
      // never touched on a database where migration 0123 hasn't run yet
      // -- a new bill without a phase is "not filed" by default anyway,
      // and an edit never blanks a phase it didn't show.
      ...(input.estimatePaymentId && input.leadId
        ? { estimate_payment_id: input.estimatePaymentId }
        : {}),
    },
  };
}

/**
 * The receipt path is client-supplied, so it is held to the slot
 * createReceiptUploadUrl issued for THIS job (or this company's
 * overhead) and checked to actually exist. Same rule job costs follow.
 */
async function receiptFieldsFor(
  companyId: string,
  leadId: string | null,
  receipt: UploadedReceipt | null | undefined
): Promise<{ error?: string; fields?: { receipt_url: string; receipt_path: string } }> {
  if (!receipt?.path) return {};
  if (!receiptPathBelongs(receipt.path, companyId, leadId)) {
    return { error: "That receipt doesn't belong to this job." };
  }
  const admin = createAdminClient();
  if (leadId) {
    const { data: lead } = await admin
      .from("leads")
      .select("id")
      .eq("id", leadId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (!lead) return { error: "Job not found." };
  }
  return confirmReceiptUpload(admin, receipt.path);
}

export async function createVendorBills(
  inputs: BillInput[]
): Promise<{ error?: string; created?: number }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canManageBills(profile)) return { error: "Bookkeeping, Office or Admin only." };
  if (!inputs.length) return { error: "Nothing to add." };
  if (inputs.length > 50) return { error: "50 bills per batch, tops." };

  const rows = [];
  const uploadedPaths: string[] = [];
  for (const input of inputs) {
    const c = cleanBill(profile.company_id, input);
    if ("error" in c) return { error: c.error };
    const r = await receiptFieldsFor(profile.company_id, input.leadId || null, input.receipt);
    if (r.error) return { error: r.error };
    if (r.fields) uploadedPaths.push(r.fields.receipt_path);
    rows.push({ ...c.row, ...(r.fields ?? {}), created_by: profile.id });
  }

  const supabase = await createClient();
  const { error } = await supabase.from("vendor_bills").insert(rows);
  if (error) {
    // No row points at the uploads -- sweep them rather than leave the
    // bucket accumulating orphans. The next attempt uploads fresh.
    if (uploadedPaths.length) {
      await createAdminClient().storage.from(RECEIPT_BUCKET).remove(uploadedPaths);
    }
    return { error: plainDbError(error.message) };
  }
  revalidatePath("/bills");
  revalidatePath("/projects");
  revalidatePath("/estimates");
  return { created: rows.length };
}

/**
 * Attaches (or replaces) the receipt file on a bill that was entered
 * without one -- the vendor's PDF arrived a week after the amount did.
 * The old file, if any, is removed once the row points at the new one.
 */
export async function setBillReceipt(
  billId: string,
  receipt: UploadedReceipt
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canManageBills(profile)) return { error: "Bookkeeping, Office or Admin only." };

  const supabase = await createClient();
  const { data: bill } = await supabase
    .from("vendor_bills")
    .select("id, lead_id, receipt_path")
    .eq("id", billId)
    .eq("company_id", profile.company_id)
    .maybeSingle<{ id: string; lead_id: string | null; receipt_path: string | null }>();
  if (!bill) return { error: "That bill couldn't be found." };

  const r = await receiptFieldsFor(profile.company_id, bill.lead_id, receipt);
  if (r.error || !r.fields) return { error: r.error ?? "No file." };

  const { data, error } = await supabase
    .from("vendor_bills")
    .update({ ...r.fields, updated_at: new Date().toISOString() })
    .eq("id", billId)
    .eq("company_id", profile.company_id)
    .select("id");
  if (error) return { error: plainDbError(error.message) };
  if (!data?.length) return { error: "That bill couldn't be updated." };

  if (bill.receipt_path?.startsWith("receipts/")) {
    await createAdminClient().storage.from(RECEIPT_BUCKET).remove([bill.receipt_path]);
  }
  revalidatePath("/bills");
  revalidatePath("/projects");
  revalidatePath("/estimates");
  return {};
}

/**
 * What is still owed on one job, bill by bill, with the phase each is
 * filed to. Job costs and the job's bill list show these beside the
 * paid costs, so an open bill is never invisible on the job.
 */
export async function getOpenJobBills(
  leadId: string
): Promise<{ error?: string; bills?: OpenJobBill[] }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  const bills = await selectAll<{
    id: string;
    lead_id: string;
    estimate_payment_id?: string | null;
    vendor_id: string | null;
    vendor_name: string | null;
    reference: string | null;
    amount_cents: number;
    bill_date: string | null;
    due_date: string | null;
    scheduled_date: string | null;
    receipt_url?: string | null;
    receipt_path?: string | null;
  }>((f, t) =>
    supabase
      .from("vendor_bills")
      .select("*")
      .eq("company_id", profile.company_id)
      .eq("lead_id", leadId)
      .is("voided_at", null)
      .order("bill_date", { ascending: false })
      .range(f, t)
  );
  if (!bills.length) return { bills: [] };

  const { data: payments } = await supabase
    .from("vendor_bill_payments")
    .select("bill_id, amount_cents")
    .eq("company_id", profile.company_id)
    .in("bill_id", bills.map((b) => b.id));
  const paidByBill = new Map<string, { amount_cents: number }[]>();
  for (const p of (payments ?? []) as { bill_id: string; amount_cents: number }[]) {
    const list = paidByBill.get(p.bill_id) ?? [];
    list.push(p);
    paidByBill.set(p.bill_id, list);
  }

  const open: OpenJobBill[] = [];
  for (const b of bills) {
    const remaining = billRemainingCents(b, paidByBill.get(b.id) ?? []);
    if (remaining <= 0) continue;
    open.push({
      id: b.id,
      lead_id: b.lead_id,
      estimate_payment_id: b.estimate_payment_id ?? null,
      vendor_id: b.vendor_id,
      vendor_name: b.vendor_name,
      reference: b.reference,
      amount_cents: b.amount_cents,
      remaining_cents: remaining,
      bill_date: b.bill_date,
      due_date: b.due_date,
      scheduled_date: b.scheduled_date,
      receipt_url: b.receipt_url ?? null,
      receipt_path: b.receipt_path ?? null,
    });
  }
  return { bills: open };
}

export async function updateVendorBill(
  billId: string,
  input: BillInput
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canManageBills(profile)) return { error: "Bookkeeping, Office or Admin only." };

  const c = cleanBill(profile.company_id, input);
  if ("error" in c) return { error: c.error };
  const { company_id: _co, ...fields } = c.row;

  const supabase = await createClient();
  // A bill with payments can still be corrected -- vendor, job, what for,
  // a bigger total -- but never below what has already been paid, and
  // the job costs its payments wrote follow the change.
  const [{ data: current }, { data: paidRows }] = await Promise.all([
    supabase
      .from("vendor_bills")
      .select("lead_id")
      .eq("id", billId)
      .eq("company_id", profile.company_id)
      .maybeSingle<{ lead_id: string | null }>(),
    supabase
      .from("vendor_bill_payments")
      .select("amount_cents, job_expense_id")
      .eq("bill_id", billId)
      .eq("company_id", profile.company_id),
  ]);
  if (!current) return { error: "That bill couldn't be found." };
  const paid = (paidRows ?? []) as { amount_cents: number; job_expense_id: string | null }[];
  const paidCents = paid.reduce((sum, p) => sum + p.amount_cents, 0);
  if (paidCents > fields.amount_cents) {
    return { error: `Already paid ${(paidCents / 100).toFixed(2)} — the total can't be less than that.` };
  }
  if (paid.length > 0 && !current.lead_id !== !fields.lead_id) {
    return {
      error:
        "This bill has payments. To move it onto or off a job, remove its payments first, then record them again.",
    };
  }
  if (
    fields.lead_id &&
    input.estimatePaymentId &&
    !(await phaseIsOnJob(profile.company_id, fields.lead_id, input.estimatePaymentId))
  ) {
    return { error: "That contract isn't on this job." };
  }

  const { data, error } = await supabase
    .from("vendor_bills")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", billId)
    .eq("company_id", profile.company_id)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "That bill couldn't be updated." };

  const costIds = paid.map((p) => p.job_expense_id).filter((id): id is string => !!id);
  if (costIds.length && fields.lead_id) {
    await createAdminClient()
      .from("job_expenses")
      .update({
        lead_id: fields.lead_id,
        vendor_id: fields.vendor_id,
        vendor: fields.vendor_name,
        ...(input.estimatePaymentId !== undefined
          ? { estimate_payment_id: input.estimatePaymentId || null }
          : fields.lead_id !== current.lead_id
            ? { estimate_payment_id: null }
            : {}),
        updated_at: new Date().toISOString(),
      })
      .in("id", costIds)
      .eq("company_id", profile.company_id);
  }
  revalidatePath("/bills");
  revalidatePath("/projects");
  revalidatePath("/estimates");
  return {};
}

/** The inline "set" on a row: when this bill is planned to be paid. */
export async function setBillSchedule(
  billId: string,
  scheduledDate: string | null
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canManageBills(profile)) return { error: "Bookkeeping, Office or Admin only." };
  if (scheduledDate !== null && !isDay(scheduledDate)) return { error: "Pick a date." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vendor_bills")
    .update({ scheduled_date: scheduledDate, updated_at: new Date().toISOString() })
    .eq("id", billId)
    .eq("company_id", profile.company_id)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "That bill couldn't be updated." };
  revalidatePath("/bills");
  return {};
}

/**
 * Records money actually leaving: a full or partial payment against a
 * bill. On a job-linked bill the payment also writes itself as that
 * job's cost, so Projects' Spent and profitability stay true with one
 * entry -- the bridge the reference product doesn't have.
 */
export async function recordBillPayment(
  billId: string,
  input: {
    amountCents: number;
    paidOn: string;
    /** How it was paid -- one of BILL_PAYMENT_METHODS. Optional so older
     *  callers keep working; stored as-is. */
    method?: string | null;
    /** Check number, Zelle confirmation, card last four -- whatever the
     *  method's reference is. The column kept its old name. */
    checkNumber?: string | null;
    note?: string | null;
    /** The payment_accounts row it came out of (migration 0176). */
    paidFromAccountId?: string | null;
  }
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canManageBills(profile)) return { error: "Bookkeeping, Office or Admin only." };
  const amount = Math.round(Number(input.amountCents) || 0);
  if (amount <= 0) return { error: "Enter the payment amount." };
  const method = (input.method ?? "").trim().toLowerCase();
  if (method && !(BILL_PAYMENT_METHODS as readonly string[]).includes(method)) {
    return { error: "Pick how it was paid from the list." };
  }
  if (!isDay(input.paidOn)) return { error: "Pick the payment date." };

  const supabase = await createClient();
  // select * rather than naming columns: the phase and receipt columns
  // arrive with migration 0123, and naming them would break paying a
  // bill on a database where it hasn't run yet.
  const { data: bill } = await supabase
    .from("vendor_bills")
    .select("*")
    .eq("id", billId)
    .eq("company_id", profile.company_id)
    .maybeSingle<{
      id: string;
      lead_id: string | null;
      vendor_id: string | null;
      vendor_name: string | null;
      reference: string | null;
      voided_at: string | null;
      estimate_payment_id?: string | null;
      receipt_url?: string | null;
      receipt_path?: string | null;
    }>();
  if (!bill) return { error: "That bill couldn't be found." };
  if (bill.voided_at) return { error: "This bill is voided — un-void it first." };

  if (input.paidFromAccountId && !(await accountsInCompany(profile.company_id, [input.paidFromAccountId]))) {
    return { error: "That account isn't one of yours." };
  }
  const res = await writeBillPayment(supabase, profile.company_id, profile.id, bill, {
    amountCents: amount,
    paidOn: input.paidOn,
    method,
    reference: input.checkNumber ?? "",
    note: input.note ?? null,
    paidFromAccountId: input.paidFromAccountId ?? "",
  });
  if (res.error) return { error: res.error };
  revalidatePath("/bills");
  revalidatePath("/estimates");
  revalidatePath("/projects");
  return {};
}

/** Undo a mis-entered payment -- takes its auto-written job cost with it. */
export async function deleteBillPayment(paymentId: string): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canManageBills(profile)) return { error: "Bookkeeping, Office or Admin only." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vendor_bill_payments")
    .delete()
    .eq("id", paymentId)
    .eq("company_id", profile.company_id)
    .select("id, job_expense_id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "That payment couldn't be found." };

  const expId = (data[0] as { job_expense_id: string | null }).job_expense_id;
  if (expId) {
    await createAdminClient().from("job_expenses").delete().eq("id", expId).eq("company_id", profile.company_id);
  }
  revalidatePath("/bills");
  revalidatePath("/estimates");
  revalidatePath("/projects");
  return {};
}

export async function setBillVoided(billId: string, voided: boolean): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canManageBills(profile)) return { error: "Bookkeeping, Office or Admin only." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vendor_bills")
    .update(
      voided
        ? { voided_at: new Date().toISOString(), voided_by: profile.id, scheduled_date: null }
        : { voided_at: null, voided_by: null }
    )
    .eq("id", billId)
    .eq("company_id", profile.company_id)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "That bill couldn't be found." };
  revalidatePath("/bills");
  revalidatePath("/projects");
  revalidatePath("/estimates");
  return {};
}

type PayableBill = {
  id: string;
  lead_id: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  reference: string | null;
  estimate_payment_id?: string | null;
  receipt_url?: string | null;
  receipt_path?: string | null;
};

type DbClient = Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdminClient>;

/** Are all these "paid from" accounts this company's? */
async function accountsInCompany(companyId: string, ids: string[]): Promise<boolean> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return true;
  const { data } = await createAdminClient()
    .from("payment_accounts")
    .select("id")
    .in("id", unique)
    .eq("company_id", companyId);
  return (data?.length ?? 0) === unique.length;
}

/**
 * One payment against a bill: on a job-linked bill, first the job cost
 * (so Projects' Spent, P&L and commission count the money the day it
 * moves), then the payment row pointing at it. The phase the bill was
 * filed to and its receipt ride along onto the cost. Any failure takes
 * the cost back out -- a cost with no payment is money that never left.
 *
 * Shared by Bills to Pay's Pay button and "+ Add bill"'s payment lines,
 * so both write exactly the rows a future QuickBooks sync reads: one
 * Bill Payment per row, its account and method on it.
 */
async function writeBillPayment(
  db: DbClient,
  companyId: string,
  profileId: string,
  bill: PayableBill,
  line: Omit<BillPaymentLine, "method"> & { method: string; note?: string | null }
): Promise<{ error?: string; jobExpenseId?: string | null }> {
  let jobExpenseId: string | null = null;
  if (bill.lead_id) {
    const { data: exp, error: expError } = await createAdminClient()
      .from("job_expenses")
      .insert({
        company_id: companyId,
        lead_id: bill.lead_id,
        estimate_payment_id: bill.estimate_payment_id ?? null,
        vendor_id: bill.vendor_id,
        vendor: bill.vendor_id ? null : bill.vendor_name,
        description: [
          bill.reference,
          line.method ? `paid by ${billPaymentMethodLabel(line.method)}` : "bill payment",
        ]
          .filter(Boolean)
          .join(" — "),
        amount_cents: line.amountCents,
        spent_on: line.paidOn,
        source: "bill",
        receipt_url: bill.receipt_url ?? null,
        receipt_path: bill.receipt_path ?? null,
        created_by: profileId,
      })
      .select("id")
      .single();
    if (expError) return { error: expError.message };
    jobExpenseId = (exp as { id: string }).id;
  }

  // A plain record on purpose: optional columns are added only when set,
  // so a database missing 0124 (method) or 0176 (account) still saves.
  const paymentRow: Record<string, unknown> = {
    company_id: companyId,
    bill_id: bill.id,
    amount_cents: line.amountCents,
    paid_on: line.paidOn,
    check_number: line.reference?.trim() || null,
    note: line.note?.trim() || null,
    job_expense_id: jobExpenseId,
    created_by: profileId,
  };
  if (line.method) paymentRow.method = line.method;
  if (line.paidFromAccountId) paymentRow.paid_from_account_id = line.paidFromAccountId;
  let { error } = await db.from("vendor_bill_payments").insert(paymentRow);
  // The method column arrives with migration 0124. Without it, keep the
  // payment and lose only the "how" -- the money moved either way.
  if (error && line.method && /schema cache/i.test(error.message) && /method/.test(error.message)) {
    delete paymentRow.method;
    ({ error } = await db.from("vendor_bill_payments").insert(paymentRow));
  }
  if (error) {
    if (jobExpenseId) {
      await createAdminClient().from("job_expenses").delete().eq("id", jobExpenseId);
    }
    return { error: error.message };
  }
  return { jobExpenseId };
}

/**
 * "+ Add bill" with money already out: the bill and every payment line
 * in one save -- paid in full, or in part with the rest left owing in
 * Bills to Pay. Each line is its own payment with its own method and
 * "paid from" account, the shape QuickBooks records a bill in (one Bill,
 * a Bill Payment per payment).
 *
 * Field records receipts at the counter but has no access to Bills to
 * Pay, so this writes with the admin client after doing by hand what the
 * policies would: company forced, job, vendor, phase and accounts all
 * proven to be this company's. Field (anyone who can't run Bills to
 * Pay) must pay the bill in full -- they can't leave one owing.
 */
export async function createBillWithPayments(
  input: BillInput & { payments: BillPaymentLine[] }
): Promise<{ error?: string; leftCents?: number }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canManageCosts(profile)) return { error: "You don't have access to record costs." };
  const runsBills = canManageBills(profile);
  if (!runsBills && !input.leadId) return { error: "Pick the job this bill belongs to." };

  const c = cleanBill(profile.company_id, input);
  if ("error" in c) return { error: c.error };
  const plan = planBillPayments(c.row.amount_cents, input.payments, { allowPartial: runsBills });
  if ("error" in plan) return { error: plan.error };

  const admin = createAdminClient();
  if (input.leadId) {
    const { data: lead } = await admin
      .from("leads")
      .select("id")
      .eq("id", input.leadId)
      .eq("company_id", profile.company_id)
      .maybeSingle();
    if (!lead) return { error: "Job not found." };
  }
  if (input.vendorId) {
    const { data: vendor } = await admin
      .from("vendors")
      .select("id")
      .eq("id", input.vendorId)
      .eq("company_id", profile.company_id)
      .maybeSingle();
    if (!vendor) return { error: "Vendor not found." };
  }
  if (
    input.estimatePaymentId &&
    input.leadId &&
    !(await phaseIsOnJob(profile.company_id, input.leadId, input.estimatePaymentId))
  ) {
    return { error: "That contract isn't on this job." };
  }
  if (!(await accountsInCompany(profile.company_id, input.payments.map((p) => p.paidFromAccountId)))) {
    return { error: "That account isn't one of yours." };
  }

  const r = await receiptFieldsFor(profile.company_id, input.leadId || null, input.receipt);
  if (r.error) return { error: r.error };

  const { data: billRow, error: billError } = await admin
    .from("vendor_bills")
    .insert({ ...c.row, ...(r.fields ?? {}), created_by: profile.id })
    .select("*")
    .single();
  if (billError || !billRow) {
    if (r.fields) await admin.storage.from(RECEIPT_BUCKET).remove([r.fields.receipt_path]);
    return { error: plainDbError(billError?.message ?? "The bill couldn't be saved.") };
  }
  const bill = billRow as PayableBill;

  // All or nothing: a half-recorded set of payments would misstate what
  // left the bank, so any failure takes the bill and its costs back out.
  const costIds: string[] = [];
  for (const line of input.payments) {
    const res = await writeBillPayment(admin, profile.company_id, profile.id, bill, {
      ...line,
      amountCents: Math.round(line.amountCents),
    });
    if (res.error) {
      if (costIds.length) await admin.from("job_expenses").delete().in("id", costIds);
      await admin.from("vendor_bills").delete().eq("id", bill.id);
      if (r.fields) await admin.storage.from(RECEIPT_BUCKET).remove([r.fields.receipt_path]);
      return { error: res.error };
    }
    if (res.jobExpenseId) costIds.push(res.jobExpenseId);
  }

  revalidatePath("/bills");
  revalidatePath("/projects");
  revalidatePath("/estimates");
  return { leftCents: plan.leftCents };
}
