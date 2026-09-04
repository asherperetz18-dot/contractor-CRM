"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { selectAll } from "@/lib/data/select-all";
import { billRemainingCents, canManageBills } from "@/lib/data/types";
import { BILL_PAYMENT_METHODS, billPaymentMethodLabel, type OpenJobBill } from "@/lib/data/bills";
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
  const { data, error } = await supabase
    .from("vendor_bills")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", billId)
    .eq("company_id", profile.company_id)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "That bill couldn't be updated." };
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

  // The job cost first, so the payment row can point at it. Admin
  // client with the same validation createJobExpense does by hand: the
  // lead is already proven to belong to this company via the bill.
  // The phase the bill was filed to and its receipt file ride along, so
  // the cost lands where the bill sat and the thumbnail follows the
  // money -- nobody re-files or re-attaches anything.
  let jobExpenseId: string | null = null;
  if (bill.lead_id) {
    const admin = createAdminClient();
    const { data: exp, error: expError } = await admin
      .from("job_expenses")
      .insert({
        company_id: profile.company_id,
        lead_id: bill.lead_id,
        estimate_payment_id: bill.estimate_payment_id ?? null,
        vendor_id: bill.vendor_id,
        vendor: bill.vendor_id ? null : bill.vendor_name,
        description: [
          bill.reference,
          method ? `paid by ${billPaymentMethodLabel(method)}` : "bill payment",
        ]
          .filter(Boolean)
          .join(" — "),
        amount_cents: amount,
        spent_on: input.paidOn,
        source: "bill",
        receipt_url: bill.receipt_url ?? null,
        receipt_path: bill.receipt_path ?? null,
        created_by: profile.id,
      })
      .select("id")
      .single();
    if (expError) return { error: expError.message };
    jobExpenseId = (exp as { id: string }).id;
  }

  // Typed as a plain record on purpose: handing insert() a conditional
  // object (with or without `method`) trips its excess-property check.
  const paymentRow: Record<string, unknown> = {
    company_id: profile.company_id,
    bill_id: billId,
    amount_cents: amount,
    paid_on: input.paidOn,
    check_number: input.checkNumber?.trim() || null,
    note: input.note?.trim() || null,
    job_expense_id: jobExpenseId,
    created_by: profile.id,
  };
  if (method) paymentRow.method = method;
  let { error } = await supabase.from("vendor_bill_payments").insert(paymentRow);
  // The method column arrives with migration 0124. On a database where it
  // hasn't run yet, record the payment without it rather than refuse the
  // payment -- the money moved either way; only the "how" is lost.
  if (error && method && /schema cache/i.test(error.message) && /method/.test(error.message)) {
    delete paymentRow.method;
    ({ error } = await supabase.from("vendor_bill_payments").insert(paymentRow));
  }
  if (error) {
    // The payment never happened; don't leave its cost behind.
    if (jobExpenseId) {
      await createAdminClient().from("job_expenses").delete().eq("id", jobExpenseId);
    }
    return { error: error.message };
  }
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
