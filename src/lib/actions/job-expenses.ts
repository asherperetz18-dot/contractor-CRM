"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { selectAll } from "@/lib/data/select-all";
import { canManageCosts, type JobExpense, type JobExpenseInput } from "@/lib/data/types";
import {
  createDriveShortcut,
  deleteFileFromDrive,
  getOrCreateCategoryFolder,
  getOrCreateLeadDriveFolder,
  getValidAccessToken,
  uploadBlobToDrive,
} from "@/lib/actions/google-drive";

const COLUMNS =
  "id, company_id, lead_id, estimate_payment_id, vendor, vendor_id, category, description, " +
  "amount_cents, spent_on, source, qb_txn_id, qb_txn_type, qb_project_id, created_at, " +
  "receipt_url, receipt_path";

const RECEIPT_BUCKET = "lead-files";
const MAX_RECEIPT_BYTES = 30 * 1024 * 1024;

/**
 * A signed slot for the receipt file (a photo from the phone camera or
 * the supplier's PDF). Uploaded straight from the browser like lead
 * files; recorded onto the expense only once createJobExpense confirms
 * the object actually landed.
 */
export async function createReceiptUploadUrl(
  leadId: string,
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
  const { data: lead } = await admin
    .from("leads")
    .select("id")
    .eq("id", leadId)
    .eq("company_id", profile.company_id)
    .maybeSingle();
  if (!lead) return { error: "Job not found." };

  const safeName = fileName.replace(/[^\w.\-() ]+/g, "_").slice(-120);
  const path = `receipts/${leadId}/${Date.now()}-${safeName}`;
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
  receipt?: { path: string; fileName: string; contentType: string | null } | null
): Promise<{ error?: string; id?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const amount = Math.round(Number(input.amountCents) || 0);
  if (!amount) return { error: "Enter an amount." };
  if (!input.spentOn) return { error: "Enter the date it was spent." };

  // The receipt path is client-supplied and this function reaches for
  // the admin client, so it is held to the slot createReceiptUploadUrl
  // actually issued: under receipts/ for THIS job, on a lead that
  // belongs to THIS company. Anything else could name another tenant's
  // object in the shared bucket. Same rule recordLeadFile enforces.
  let receiptFields: { receipt_url: string; receipt_path: string } | null = null;
  if (receipt?.path) {
    if (!canManageCosts(profile)) return { error: "You don't have access to record costs." };
    if (!receipt.path.startsWith(`receipts/${input.leadId}/`)) {
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

    const folder = receipt.path.slice(0, receipt.path.lastIndexOf("/"));
    const base = receipt.path.slice(receipt.path.lastIndexOf("/") + 1);
    const { data: listed } = await admin.storage
      .from(RECEIPT_BUCKET)
      .list(folder, { search: base });
    if (!listed?.some((f) => f.name === base)) {
      return { error: "The receipt upload didn't finish. Try attaching it again." };
    }
    receiptFields = {
      receipt_url: admin.storage.from(RECEIPT_BUCKET).getPublicUrl(receipt.path).data.publicUrl,
      receipt_path: receipt.path,
    };
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
    .select("id, receipt_path");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "That cost couldn't be deleted." };

  // The receipt file goes with the cost. Left behind, a bucket object
  // keeps serving at its old public URL and a Drive file sits in the
  // customer's folder claiming a cost that no longer exists. Best
  // effort: a cleanup hiccup must not resurrect the row.
  const receiptPath = (data[0] as { receipt_path?: string | null }).receipt_path;
  if (receiptPath) {
    try {
      if (receiptPath.startsWith("drive:")) {
        const token = await getValidAccessToken(profile.company_id);
        if (token?.accessToken) {
          await deleteFileFromDrive(receiptPath.slice("drive:".length), token.accessToken);
        }
      } else if (receiptPath.startsWith("receipts/")) {
        await createAdminClient().storage.from(RECEIPT_BUCKET).remove([receiptPath]);
      }
    } catch {
      // ignore -- the cost is gone, which is what was asked.
    }
  }

  revalidatePath("/estimates");
  return {};
}
