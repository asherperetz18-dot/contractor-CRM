"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { canManageBills } from "@/lib/data/types";

export type BillInput = {
  vendorId?: string | null;
  vendorName?: string | null;
  leadId?: string | null;
  reference?: string | null;
  amountCents: number;
  billDate?: string | null;
  dueDate?: string | null;
  scheduledDate?: string | null;
  notes?: string | null;
};

const isDay = (s?: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

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
    },
  };
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
  for (const input of inputs) {
    const c = cleanBill(profile.company_id, input);
    if ("error" in c) return { error: c.error };
    rows.push({ ...c.row, created_by: profile.id });
  }

  const supabase = await createClient();
  const { error } = await supabase.from("vendor_bills").insert(rows);
  if (error) return { error: error.message };
  revalidatePath("/bills");
  return { created: rows.length };
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
  input: { amountCents: number; paidOn: string; checkNumber?: string | null; note?: string | null }
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canManageBills(profile)) return { error: "Bookkeeping, Office or Admin only." };
  const amount = Math.round(Number(input.amountCents) || 0);
  if (amount <= 0) return { error: "Enter the payment amount." };
  if (!isDay(input.paidOn)) return { error: "Pick the payment date." };

  const supabase = await createClient();
  const { data: bill } = await supabase
    .from("vendor_bills")
    .select("id, lead_id, vendor_id, vendor_name, reference, voided_at")
    .eq("id", billId)
    .eq("company_id", profile.company_id)
    .maybeSingle<{
      id: string;
      lead_id: string | null;
      vendor_id: string | null;
      vendor_name: string | null;
      reference: string | null;
      voided_at: string | null;
    }>();
  if (!bill) return { error: "That bill couldn't be found." };
  if (bill.voided_at) return { error: "This bill is voided — un-void it first." };

  // The job cost first, so the payment row can point at it. Admin
  // client with the same validation createJobExpense does by hand: the
  // lead is already proven to belong to this company via the bill.
  let jobExpenseId: string | null = null;
  if (bill.lead_id) {
    const admin = createAdminClient();
    const { data: exp, error: expError } = await admin
      .from("job_expenses")
      .insert({
        company_id: profile.company_id,
        lead_id: bill.lead_id,
        vendor_id: bill.vendor_id,
        vendor: bill.vendor_id ? null : bill.vendor_name,
        description: [bill.reference, "bill payment"].filter(Boolean).join(" — "),
        amount_cents: amount,
        spent_on: input.paidOn,
        source: "bill",
        created_by: profile.id,
      })
      .select("id")
      .single();
    if (expError) return { error: expError.message };
    jobExpenseId = (exp as { id: string }).id;
  }

  const { error } = await supabase.from("vendor_bill_payments").insert({
    company_id: profile.company_id,
    bill_id: billId,
    amount_cents: amount,
    paid_on: input.paidOn,
    check_number: input.checkNumber?.trim() || null,
    note: input.note?.trim() || null,
    job_expense_id: jobExpenseId,
    created_by: profile.id,
  });
  if (error) {
    // The payment never happened; don't leave its cost behind.
    if (jobExpenseId) {
      await createAdminClient().from("job_expenses").delete().eq("id", jobExpenseId);
    }
    return { error: error.message };
  }
  revalidatePath("/bills");
  revalidatePath("/estimates");
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
  return {};
}
