"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { selectAll } from "@/lib/data/select-all";
import {
  canManageCosts,
  contractFilingOptions,
  contractOfCost,
  type ContractFilingOption,
  type JobExpense,
  type JobExpenseInput,
} from "@/lib/data/types";
import {
  canEditJobCosts,
  expenseEditLock,
  jobExpensePatch,
  type JobExpenseEdit,
} from "@/lib/data/expense-edit";
import {
  createDriveShortcut,
  deleteFileFromDrive,
  getOrCreateCategoryFolder,
  getOrCreateLeadDriveFolder,
  getValidAccessToken,
  uploadBlobToDrive,
} from "@/lib/actions/google-drive";
import {
  MAX_RECEIPT_BYTES,
  RECEIPT_BUCKET,
  confirmReceiptUpload,
  receiptPathBelongs,
  receiptUploadPath,
  type UploadedReceipt,
} from "@/lib/receipts";

const COLUMNS =
  "id, company_id, lead_id, estimate_payment_id, vendor, vendor_id, category, description, " +
  "amount_cents, spent_on, source, qb_txn_id, qb_txn_type, qb_project_id, created_at, " +
  "receipt_url, receipt_path";

/**
 * A signed slot for the receipt file (a photo from the phone camera or
 * the supplier's PDF). Uploaded straight from the browser like lead
 * files; recorded onto the bill or cost only once the save confirms the
 * object actually landed.
 *
 * leadId null is an overhead bill with no job (fuel, the office): the
 * slot lives under the company instead.
 */
export async function createReceiptUploadUrl(
  leadId: string | null,
  fileName: string,
  fileSize: number
): Promise<{ error?: string; path?: string; token?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  // Same gate the expense insert enforces, checked before anything is
  // uploaded -- a role that cannot record costs gets no storage slot.
  if (!canManageCosts(profile)) return { error: "You don't have access to record costs." };
  if (!fileName) return { error: "No file chosen." };
  if (fileSize > MAX_RECEIPT_BYTES) {
    return { error: "That file is over 30MB — scan it smaller and try again." };
  }

  const admin = createAdminClient();
  if (leadId) {
    const { data: lead } = await admin
      .from("leads")
      .select("id")
      .eq("id", leadId)
      .eq("company_id", profile.company_id)
      .maybeSingle();
    if (!lead) return { error: "Job not found." };
  }

  const path = receiptUploadPath(profile.company_id, leadId, fileName);
  const { data, error } = await admin.storage
    .from(RECEIPT_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) return { error: error?.message || "Couldn't prepare the upload." };
  return { path: data.path, token: data.token };
}

/**
 * Best-effort promotion of a saved receipt into Google Drive: into the
 * job's folder with a shortcut under "Receipts", like every other job
 * file. Runs only AFTER the expense row exists pointing at the bucket
 * copy, so every failure mode leaves a receipt the row can still reach.
 * The bucket object is removed only once the row points at Drive; a row
 * update that fails deletes the fresh Drive copy rather than orphan it.
 */
async function promoteReceiptToDrive(
  companyId: string,
  leadId: string,
  expenseId: string,
  path: string,
  fileName: string,
  contentType: string | null
): Promise<void> {
  const admin = createAdminClient();
  try {
    const token = await getValidAccessToken(companyId);
    if (!token?.accessToken) return;

    const { data: blob } = await admin.storage.from(RECEIPT_BUCKET).download(path);
    if (!blob) return;

    const leadFolderId = await getOrCreateLeadDriveFolder(leadId, companyId);
    if (!leadFolderId) return;

    const uploaded = await uploadBlobToDrive(
      fileName,
      blob,
      contentType || "application/octet-stream",
      token.accessToken,
      leadFolderId
    );
    if ("error" in uploaded || !uploaded.url) return;

    const categoryId = await getOrCreateCategoryFolder("Receipts", token.accessToken, token.folderId);
    if (categoryId) {
      await createDriveShortcut(uploaded.id, categoryId, fileName, token.accessToken);
    }

    const updated = await admin
      .from("job_expenses")
      .update({ receipt_url: uploaded.url, receipt_path: `drive:${uploaded.id}` })
      .eq("id", expenseId)
      .eq("company_id", companyId)
      .select("id");
    if (updated.error || !updated.data?.length) {
      await deleteFileFromDrive(uploaded.id, token.accessToken);
      return;
    }
    await admin.storage.from(RECEIPT_BUCKET).remove([path]);
  } catch {
    // The bucket copy stays and the row keeps pointing at it -- a
    // receipt that exists beats one lost to a Drive hiccup.
  }
}

/**
 * Every cost recorded against one job, newest first.
 *
 * Keyed on the lead rather than the estimate: a job's costs do not
 * belong to one document. A contract, its change orders and its
 * completion all draw on the same pile of materials and the same crew,
 * and a bathroom that went over on tile went over once, not once per
 * document it might be filed under.
 */
export async function getJobExpenses(
  leadId: string
): Promise<{ error?: string; expenses?: JobExpense[] }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  // selectAll rather than a bare select: a long job with a lot of
  // receipts would otherwise stop at 1000 and understate its own cost,
  // which is the one number this whole feature exists to get right.
  const rows = await selectAll<JobExpense>((from, to) =>
    supabase
      .from("job_expenses")
      .select(COLUMNS)
      .eq("lead_id", leadId)
      .eq("company_id", profile.company_id)
      .order("spent_on", { ascending: false })
      .range(from, to)
  );
  return { expenses: rows };
}

export async function createJobExpense(
  input: JobExpenseInput,
  // The already-uploaded receipt file, when one was attached.
  receipt?: UploadedReceipt | null
): Promise<{ error?: string; id?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const amount = Math.round(Number(input.amountCents) || 0);
  if (!amount) return { error: "Enter an amount." };
  if (!input.spentOn) return { error: "Enter the date it was spent." };
  if (!input.leadId) return { error: "Pick the job this belongs to." };

  // The receipt path is client-supplied and this function reaches for
  // the admin client, so it is held to the slot createReceiptUploadUrl
  // actually issued: under receipts/ for THIS job, on a lead that
  // belongs to THIS company. Anything else could name another tenant's
  // object in the shared bucket. Same rule recordLeadFile enforces.
  let receiptFields: { receipt_url: string; receipt_path: string } | null = null;
  if (receipt?.path) {
    if (!canManageCosts(profile)) return { error: "You don't have access to record costs." };
    if (!receiptPathBelongs(receipt.path, profile.company_id, input.leadId)) {
      return { error: "That receipt doesn't belong to this job." };
    }
    const admin = createAdminClient();
    const { data: lead } = await admin
      .from("leads")
      .select("id")
      .eq("id", input.leadId)
      .eq("company_id", profile.company_id)
      .maybeSingle();
    if (!lead) return { error: "Job not found." };

    const confirmed = await confirmReceiptUpload(admin, receipt.path);
    if (confirmed.error || !confirmed.fields) return { error: confirmed.error };
    receiptFields = confirmed.fields;
  }

  if (input.estimatePaymentId && !(await phaseIsOnJob(profile.company_id, input.leadId, input.estimatePaymentId))) {
    return { error: "That contract isn't on this job." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("job_expenses")
    .insert({
      ...(receiptFields ?? {}),
      company_id: profile.company_id,
      lead_id: input.leadId,
      estimate_payment_id: input.estimatePaymentId || null,
      vendor_id: input.vendorId || null,
      // Only kept when no vendor record was picked. Storing both would
      // be two names for one supplier, free to drift apart the moment
      // somebody corrects the vendor record.
      vendor: input.vendorId ? null : input.vendor?.trim() || null,
      category: input.category?.trim() || null,
      description: input.description?.trim() || null,
      amount_cents: amount,
      spent_on: input.spentOn,
      source: "manual",
      created_by: profile.id,
    })
    .select("id")
    .single();
  if (error) {
    // The row never happened, so nothing references the upload -- sweep
    // it rather than leave the bucket accumulating orphans. The next
    // attempt uploads fresh under a new timestamped path.
    if (receipt?.path && receiptFields) {
      await createAdminClient().storage.from(RECEIPT_BUCKET).remove([receipt.path]);
    }
    return { error: error.message };
  }

  const id = (data as { id: string }).id;
  // Only after the row exists, and pointing at the bucket copy until the
  // very last step -- every way this can fail leaves a reachable receipt.
  if (receipt?.path && receiptFields) {
    await promoteReceiptToDrive(
      profile.company_id,
      input.leadId,
      id,
      receipt.path,
      receipt.fileName,
      receipt.contentType
    );
  }

  revalidatePath("/estimates");
  return { id };
}

/**
 * Files an expense against a phase, or moves it back to unassigned.
 *
 * Company-scoped and checked by row count. Matching on id alone would
 * take whatever id arrived, and a server action is reachable directly --
 * so another company's cost would be one guessed uuid from being moved
 * onto a job it has nothing to do with.
 */
export async function assignExpensePhase(
  expenseId: string,
  estimatePaymentId: string | null
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("job_expenses")
    .update({ estimate_payment_id: estimatePaymentId || null, updated_at: new Date().toISOString() })
    .eq("id", expenseId)
    .eq("company_id", profile.company_id)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "That cost couldn't be updated." };

  revalidatePath("/estimates");
  return {};
}

export async function deleteJobExpense(expenseId: string): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("job_expenses")
    .delete()
    .eq("id", expenseId)
    .eq("company_id", profile.company_id)
    .select("id, receipt_path, source");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "That cost couldn't be deleted." };

  // The receipt file goes with the cost. Left behind, a bucket object
  // keeps serving at its old public URL and a Drive file sits in the
  // customer's folder claiming a cost that no longer exists. Best
  // effort: a cleanup hiccup must not resurrect the row.
  //
  // Except a cost written by paying a bill: the file is the BILL's, and
  // the bill still points at it. Deleting it here would blank the bill's
  // thumbnail on the checkbook page.
  const row = data[0] as { receipt_path?: string | null; source?: string | null };
  if (row.source !== "bill") await removeReceiptFile(profile.company_id, row.receipt_path ?? null);

  revalidatePath("/estimates");
  return {};
}

/** Best effort: a cleanup hiccup must never undo the row change it follows. */
async function removeReceiptFile(companyId: string, receiptPath: string | null): Promise<void> {
  if (!receiptPath) return;
  try {
    if (receiptPath.startsWith("drive:")) {
      const token = await getValidAccessToken(companyId);
      if (token?.accessToken) {
        await deleteFileFromDrive(receiptPath.slice("drive:".length), token.accessToken);
      }
    } else if (receiptPath.startsWith("receipts/")) {
      await createAdminClient().storage.from(RECEIPT_BUCKET).remove([receiptPath]);
    }
  } catch {
    // ignore
  }
}

type EditableRow = {
  id: string;
  lead_id: string;
  estimate_payment_id: string | null;
  source: string;
  receipt_path: string | null;
};

/**
 * The cost as it stands, refused unless this person may edit it. Read
 * through the company-scoped client, so another tenant's id is simply
 * "not found".
 */
async function loadEditable(
  expenseId: string
): Promise<{ error: string } | { row: EditableRow; companyId: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canEditJobCosts(profile)) return { error: "You don't have access to edit costs." };

  const supabase = await createClient();
  const { data } = await supabase
    .from("job_expenses")
    .select("id, lead_id, estimate_payment_id, source, receipt_path")
    .eq("id", expenseId)
    .eq("company_id", profile.company_id)
    .maybeSingle();
  if (!data) return { error: "That cost wasn't found." };
  const row = data as EditableRow;
  const lock = expenseEditLock(row);
  if (lock) return { error: `${lock} — change it there.` };
  return { row, companyId: profile.company_id };
}

/**
 * Checks a freshly uploaded receipt against the slot it must have come
 * from (this company's job) and that it actually landed. Same rules as
 * createJobExpense.
 */
async function confirmNewReceipt(
  companyId: string,
  leadId: string,
  receipt: UploadedReceipt
): Promise<{ error?: string; fields?: { receipt_url: string; receipt_path: string } }> {
  if (!receiptPathBelongs(receipt.path, companyId, leadId)) {
    return { error: "That receipt doesn't belong to this job." };
  }
  return confirmReceiptUpload(createAdminClient(), receipt.path);
}

/**
 * Corrects a cost saved by hand -- the "Already paid" receipt with the
 * wrong amount, vendor, date or job -- optionally swapping its receipt.
 * The old file is removed only after the row points at the new one.
 */
export async function updateJobExpense(
  expenseId: string,
  input: JobExpenseEdit,
  receipt?: UploadedReceipt | null
): Promise<{ error?: string }> {
  const loaded = await loadEditable(expenseId);
  if ("error" in loaded) return { error: loaded.error };
  const { row, companyId } = loaded;

  const res = jobExpensePatch(input, row);
  if ("error" in res) return { error: res.error };
  const patch = res.patch;

  const supabase = await createClient();
  if (patch.lead_id !== row.lead_id) {
    // The write policy checks the company column, not the job's -- a
    // lead id from another company would pass it untouched.
    const { data: lead } = await supabase
      .from("leads")
      .select("id")
      .eq("id", patch.lead_id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (!lead) return { error: "Job not found." };
  }

  if (
    patch.estimate_payment_id &&
    patch.estimate_payment_id !== row.estimate_payment_id &&
    !(await phaseIsOnJob(companyId, patch.lead_id, patch.estimate_payment_id))
  ) {
    return { error: "That contract isn't on this job." };
  }

  let receiptFields: { receipt_url: string; receipt_path: string } | null = null;
  if (receipt?.path) {
    const confirmed = await confirmNewReceipt(companyId, patch.lead_id, receipt);
    if (confirmed.error || !confirmed.fields) return { error: confirmed.error };
    receiptFields = confirmed.fields;
  }

  const { data, error } = await supabase
    .from("job_expenses")
    .update({ ...patch, ...(receiptFields ?? {}), updated_at: new Date().toISOString() })
    .eq("id", expenseId)
    .eq("company_id", companyId)
    .select("id");
  if (error || !data?.length) {
    if (receiptFields) await createAdminClient().storage.from(RECEIPT_BUCKET).remove([receipt!.path]);
    return { error: error?.message || "That cost couldn't be updated." };
  }

  if (receipt?.path && receiptFields) {
    await removeReceiptFile(companyId, row.receipt_path);
    await promoteReceiptToDrive(
      companyId,
      patch.lead_id,
      expenseId,
      receipt.path,
      receipt.fileName,
      receipt.contentType
    );
  }

  revalidatePath("/estimates");
  revalidatePath("/bills");
  return {};
}

/** Attaches (or replaces) the receipt on a cost saved without one. */
export async function setJobExpenseReceipt(
  expenseId: string,
  receipt: UploadedReceipt
): Promise<{ error?: string }> {
  const loaded = await loadEditable(expenseId);
  if ("error" in loaded) return { error: loaded.error };
  const { row, companyId } = loaded;

  const confirmed = await confirmNewReceipt(companyId, row.lead_id, receipt);
  if (confirmed.error || !confirmed.fields) return { error: confirmed.error };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("job_expenses")
    .update({ ...confirmed.fields, updated_at: new Date().toISOString() })
    .eq("id", expenseId)
    .eq("company_id", companyId)
    .select("id");
  if (error || !data?.length) {
    await createAdminClient().storage.from(RECEIPT_BUCKET).remove([receipt.path]);
    return { error: error?.message || "The receipt couldn't be attached." };
  }

  await removeReceiptFile(companyId, row.receipt_path);
  await promoteReceiptToDrive(
    companyId,
    row.lead_id,
    expenseId,
    receipt.path,
    receipt.fileName,
    receipt.contentType
  );

  revalidatePath("/estimates");
  revalidatePath("/bills");
  return {};
}

/**
 * Is this payment phase on one of this job's documents? The write policy
 * checks only the cost's company, so a phase id from another job -- or
 * another company -- would otherwise file the cost against a contract it
 * has nothing to do with.
 */
async function phaseIsOnJob(companyId: string, leadId: string, phaseId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data: phase } = await admin
    .from("estimate_payments")
    .select("estimate_id")
    .eq("id", phaseId)
    .maybeSingle<{ estimate_id: string }>();
  if (!phase) return false;
  const { data: doc } = await admin
    .from("estimates")
    .select("id")
    .eq("id", phase.estimate_id)
    .eq("lead_id", leadId)
    .eq("company_id", companyId)
    .maybeSingle();
  return !!doc;
}

/**
 * The "Which contract?" choices for a bill on this job. Only asked when
 * the customer holds more than one contract -- with one, an unfiled
 * cost is already that contract's.
 *
 * Read with the admin client because Field records receipts but cannot
 * open estimates; what comes back is document numbers, titles and phase
 * names, never an amount, and only for a job in this company.
 */
export async function getJobFilingOptions(leadId: string): Promise<{
  error?: string;
  options?: ContractFilingOption[];
  /** Phase id -> the contract it counts toward (commission's reading). */
  phaseContract?: Record<string, string>;
}> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canManageCosts(profile)) return { error: "You don't have access to record costs." };
  return loadFiling(profile.company_id, leadId);
}

async function loadFiling(
  companyId: string,
  leadId: string
): Promise<{ options: ContractFilingOption[]; phaseContract: Record<string, string> }> {
  const admin = createAdminClient();
  const { data: docs } = await admin
    .from("estimates")
    .select("id, doc_number, title, kind, parent_estimate_id")
    .eq("lead_id", leadId)
    .eq("company_id", companyId)
    .eq("status", "Signed");
  const list = (docs ?? []) as {
    id: string;
    doc_number: string;
    title: string | null;
    kind: string | null;
    parent_estimate_id: string | null;
  }[];
  if (list.length === 0) return { options: [], phaseContract: {} };

  // select * so cancelled_at rides along where its migration has run.
  const { data: phaseRows } = await admin
    .from("estimate_payments")
    .select("*")
    .in(
      "estimate_id",
      list.map((d) => d.id)
    );
  const phases = (phaseRows ?? []) as {
    id: string;
    estimate_id: string;
    name: string | null;
    sort_order: number;
    cancelled_at?: string | null;
  }[];
  const phaseContract: Record<string, string> = {};
  for (const p of phases) {
    const contract = contractOfCost(p.id, list, phases);
    if (contract) phaseContract[p.id] = contract;
  }
  return { options: contractFilingOptions(list, phases), phaseContract };
}

/**
 * Files bills to one contract in a click -- the project row's own -- so
 * the commission report counts them. Each goes to the contract's first
 * phase, the same default "+ Add bill" uses from a project row; a bill
 * already on another of the customer's contracts is left where it is.
 */
export async function fileCostsToContract(
  expenseIds: string[],
  estimateId: string
): Promise<{ error?: string; filed?: number }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canEditJobCosts(profile)) return { error: "You don't have access to edit costs." };
  if (expenseIds.length === 0) return { filed: 0 };

  const supabase = await createClient();
  const { data: contract } = await supabase
    .from("estimates")
    .select("id, lead_id")
    .eq("id", estimateId)
    .eq("company_id", profile.company_id)
    .maybeSingle<{ id: string; lead_id: string }>();
  if (!contract) return { error: "Contract not found." };

  const { options, phaseContract } = await loadFiling(profile.company_id, contract.lead_id);
  const phaseId = options.find((o) => o.estimateId === estimateId)?.phases[0]?.id;
  if (!phaseId) return { error: "That contract has no payment phases to file bills to." };

  const { data: rows } = await supabase
    .from("job_expenses")
    .select("id, estimate_payment_id")
    .in("id", expenseIds)
    .eq("lead_id", contract.lead_id)
    .eq("company_id", profile.company_id);
  const ids = ((rows ?? []) as { id: string; estimate_payment_id: string | null }[])
    .filter((r) => !r.estimate_payment_id || !phaseContract[r.estimate_payment_id])
    .map((r) => r.id);
  if (ids.length === 0) return { filed: 0 };

  const { data, error } = await supabase
    .from("job_expenses")
    .update({ estimate_payment_id: phaseId, updated_at: new Date().toISOString() })
    .in("id", ids)
    .eq("company_id", profile.company_id)
    .select("id");
  if (error) return { error: error.message };

  revalidatePath("/estimates");
  revalidatePath("/projects");
  return { filed: data?.length ?? 0 };
}
