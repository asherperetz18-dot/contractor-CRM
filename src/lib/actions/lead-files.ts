"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import {
  createDriveShortcut,
  deleteFileFromDrive,
  getOrCreateCategoryFolder,
  getOrCreateLeadDriveFolder,
  getValidAccessToken,
  uploadBlobToDrive,
  uploadFileToDrive,
} from "./google-drive";

/**
 * The ceiling for a file going straight to Supabase Storage.
 *
 * Deliberately NOT bounded by serverActions.bodySizeLimit any more.
 * That setting said 25MB and never meant anything: Vercel rejects a
 * request body over about 4.5MB with a 413 before the function is even
 * invoked, so every one of these limits above 4.5MB was decoration.
 * Measured against production -- a 3MB body reached the app, a 5MB body
 * came back 413 -- which is why the largest file ever uploaded here was
 * 1.39MB despite the config promising twenty times that.
 *
 * Files now go from the browser to Supabase directly (see
 * createLeadFileUploadUrl), so the only real ceilings left are this one
 * and the storage project's own upload limit.
 */
const MAX_SUPABASE_FILE_BYTES = 80 * 1024 * 1024;

/**
 * Drive is the exception and stays small.
 *
 * A Drive upload still goes through the server, so it is stuck under
 * Vercel's 4.5MB body limit whatever this says. Left at 4MB to state the
 * truth rather than promise 20MB that 413s -- raising Drive properly
 * means resumable uploads from the browser, which is a separate job.
 */
const MAX_DRIVE_FILE_BYTES = 4 * 1024 * 1024;
const BUCKET = "lead-files";

export async function uploadLeadFile(
  leadId: string,
  formData: FormData,
  // Set when the photo was taken on a specific visit, so it sits on that
  // appointment as well as rolling up to the contact.
  eventId?: string | null
): Promise<{ error?: string }> {
  const file = formData.get("file");
  if (!(file instanceof File) || !file.name) return { error: "No file selected." };

  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  const drive = await getValidAccessToken(profile.company_id);

  if (drive) {
    if (file.size > MAX_DRIVE_FILE_BYTES) {
      return { error: "That file is over 20MB — Drive uploads are capped there for now." };
    }
    const leadFolderId = await getOrCreateLeadDriveFolder(leadId, profile.company_id);
    if (!leadFolderId) return { error: "Could not prepare this contact's Drive folder." };

    const uploaded = await uploadFileToDrive(file, drive.accessToken, leadFolderId);
    if ("error" in uploaded) return { error: uploaded.error };

    const { error } = await supabase.from("lead_files").insert({
      lead_id: leadId,
      uploaded_by: profile.id,
      file_name: file.name,
      file_path: uploaded.id,
      file_url: uploaded.url,
      file_size: file.size,
      content_type: file.type || null,
      storage_provider: "google_drive",
      event_id: eventId ?? null,
      company_id: profile.company_id,
    });
    if (error) return { error: error.message };

    revalidatePath("/pipeline");
    revalidatePath("/contacts");
    return {};
  }

  if (file.size > MAX_SUPABASE_FILE_BYTES) {
    return {
      error:
        "That file is over 25MB. Connect Google Drive in Settings, or record a shorter video.",
    };
  }

  const admin = createAdminClient();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${leadId}/${Date.now()}-${safeName}`;

  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type || undefined });
  if (uploadError) return { error: uploadError.message };

  const {
    data: { publicUrl },
  } = admin.storage.from(BUCKET).getPublicUrl(path);

  const { error } = await supabase.from("lead_files").insert({
    lead_id: leadId,
    uploaded_by: profile.id,
    file_name: file.name,
    file_path: path,
    file_url: publicUrl,
    file_size: file.size,
    content_type: file.type || null,
    storage_provider: "supabase",
    event_id: eventId ?? null,
    company_id: profile.company_id,
  });
  if (error) return { error: error.message };

  revalidatePath("/pipeline");
  revalidatePath("/contacts");
  return {};
}

/**
 * Step one of a large upload: permission, then a one-time URL.
 *
 * The file itself never passes through here. Vercel caps a request body
 * at about 4.5MB, so anything bigger has to go from the browser to
 * Supabase directly -- this only decides whether it is allowed to, and
 * hands back a short-lived token for one specific path.
 *
 * The size is taken on trust for the check, which is fine: the token is
 * scoped to a single path in one bucket, and the storage project's own
 * upload limit is the real backstop. Lying about the number here buys
 * nothing that uploading a big file honestly would not.
 */
export async function createLeadFileUploadUrl(
  leadId: string,
  fileName: string,
  fileSize: number
): Promise<{ error?: string; path?: string; token?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!fileName) return { error: "No file selected." };
  if (fileSize > MAX_SUPABASE_FILE_BYTES) {
    return {
      error: `That file is over ${Math.round(MAX_SUPABASE_FILE_BYTES / 1024 / 1024)}MB.`,
    };
  }

  // The boundary here is the company, checked with the admin client on
  // purpose: a sales-scoped rep photographing their own visit is often
  // standing at a customer that belongs to a colleague's book, which
  // their RLS view hides -- reading as the signed-in user refused
  // exactly the person the Photos tab exists for. Cross-company probing
  // still dies here, and the lead_files insert policy has the final
  // word on whether their role may record the file at all.
  const adminCheck = createAdminClient();
  const { data: lead } = await adminCheck
    .from("leads")
    .select("id")
    .eq("id", leadId)
    .eq("company_id", profile.company_id)
    .maybeSingle<{ id: string }>();
  if (!lead) return { error: "That contact isn't available." };

  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${leadId}/${Date.now()}-${safeName}`;

  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error) return { error: error.message };
  return { path: data.path, token: data.token };
}

/**
 * Step two: the file is in storage, record what it is.
 *
 * Separate from step one because between them the browser does the
 * upload, and a row written before that would list a file that may never
 * have arrived. The object is checked to exist here rather than trusted,
 * so a failed or abandoned upload cannot leave a phantom attachment.
 */
/** Photos for anything the camera made; Documents for the rest. */
function categoryFor(contentType: string | null): string {
  return contentType?.startsWith("image/") || contentType?.startsWith("video/")
    ? "Photos"
    : "Documents";
}

async function fileCategoryShortcut(
  driveFileId: string,
  fileName: string,
  contentType: string | null,
  accessToken: string,
  rootFolderId: string
): Promise<string | null> {
  const folder = await getOrCreateCategoryFolder(
    categoryFor(contentType),
    accessToken,
    rootFolderId
  );
  if (!folder) return null;
  return createDriveShortcut(driveFileId, folder, fileName, accessToken);
}

export async function recordLeadFile(
  leadId: string,
  path: string,
  fileName: string,
  fileSize: number,
  contentType: string | null,
  eventId?: string | null,
  /** Files the upload under one job -- see migration 0120. */
  estimateId?: string | null
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!path.startsWith(`${leadId}/`)) return { error: "That upload doesn't belong here." };

  const admin = createAdminClient();

  // The job a file is filed under must be this lead's own document --
  // estimate_id decides which project row shows the file, and an
  // unvalidated id would let an upload masquerade under another
  // customer's contract.
  let fileUnder: string | null = null;
  if (estimateId) {
    const { data: est } = await admin
      .from("estimates")
      .select("id")
      .eq("id", estimateId)
      .eq("lead_id", leadId)
      .eq("company_id", profile.company_id)
      .maybeSingle();
    if (est) fileUnder = estimateId;
  }
  const slash = path.lastIndexOf("/");
  const { data: found } = await admin.storage
    .from(BUCKET)
    .list(path.slice(0, slash), { search: path.slice(slash + 1) });
  if (!found?.length) return { error: "That upload didn't finish. Please try again." };

  const {
    data: { publicUrl },
  } = admin.storage.from(BUCKET).getPublicUrl(path);

  // When the company connected Google Drive, the file's real home is
  // there. It still ARRIVES via Supabase Storage -- the browser cannot
  // post more than ~4.5MB through a server action, which is exactly why
  // this signed-URL path exists -- so the server now walks it the rest
  // of the way: download from the bucket, resumable-upload into the
  // lead's Drive folder, drop the bucket copy. When this shipped, the
  // Cloud Storage page had been promising Drive for weeks while every
  // upload quietly stayed in app storage: the direct path never asked.
  // Any Drive failure falls back to keeping the Supabase copy -- an
  // upload must never be lost because Drive hiccupped. Capped at 30MB
  // so the transfer fits comfortably inside a serverless invocation.
  let stored: {
    provider: string;
    filePath: string;
    fileUrl: string | null;
    shortcutId?: string | null;
  } = {
    provider: "supabase",
    filePath: path,
    fileUrl: publicUrl,
  };
  if (fileSize <= 30 * 1024 * 1024) {
    const drive = await getValidAccessToken(profile.company_id);
    if (drive) {
      const folderId = await getOrCreateLeadDriveFolder(leadId, profile.company_id);
      const { data: blob } = folderId
        ? await admin.storage.from(BUCKET).download(path)
        : { data: null };
      if (folderId && blob) {
        const uploaded = await uploadBlobToDrive(
          fileName,
          blob,
          contentType || "application/octet-stream",
          drive.accessToken,
          folderId
        );
        if (!("error" in uploaded)) {
          stored = { provider: "google_drive", filePath: uploaded.id, fileUrl: uploaded.url };
          await admin.storage.from(BUCKET).remove([path]);
          // The category view: Photos for images and video, Documents
          // for the rest. A shortcut, so the file lives once in the
          // lead's folder and appears again where a person browsing by
          // type would look. Best-effort -- the upload has already
          // succeeded, and a missing shortcut is a cosmetic gap.
          stored.shortcutId = await fileCategoryShortcut(
            uploaded.id,
            fileName,
            contentType,
            drive.accessToken,
            drive.folderId
          );
        }
      }
    }
  }

  const supabase = await createClient();
  // No RETURNING on purpose. An insert the policy refuses fails loudly
  // (unlike updates, which match zero rows) -- while RETURNING would
  // additionally demand SELECT visibility of the new row, which a
  // sales-scoped rep photographing a colleague's customer doesn't have.
  // Their upload was being refused for the crime of not being allowed
  // to read it back.
  const { error } = await supabase.from("lead_files").insert({
    lead_id: leadId,
    uploaded_by: profile.id,
    file_name: fileName,
    file_path: stored.filePath,
    file_url: stored.fileUrl,
    file_size: fileSize,
    content_type: contentType,
    storage_provider: stored.provider,
    drive_shortcut_id: stored.shortcutId ?? null,
    event_id: eventId ?? null,
    estimate_id: fileUnder,
    company_id: profile.company_id,
  });
  if (error) {
    // Nothing points at the object now -- don't leave it orphaned,
    // wherever it ended up.
    if (stored.provider === "google_drive") {
      const drive = await getValidAccessToken(profile.company_id);
      if (drive) await deleteFileFromDrive(stored.filePath, drive.accessToken);
    } else {
      await admin.storage.from(BUCKET).remove([path]);
    }
    return { error: "That file couldn't be attached to this contact." };
  }

  revalidatePath("/pipeline");
  revalidatePath("/contacts");
  return {};
}

export async function deleteLeadFile(
  id: string,
  filePath: string,
  storageProvider?: string
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  // Ask for the row back: an RLS refusal matches zero rows with no
  // error, and the storage object must never be removed on the say-so
  // of a delete the table just refused.
  const { data: deleted, error } = await supabase
    .from("lead_files")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) return { error: error.message };
  if (!deleted?.length) {
    return { error: "Only Office or Admin can delete files." };
  }

  if (storageProvider === "google_drive") {
    const drive = await getValidAccessToken(profile.company_id);
    if (drive) await deleteFileFromDrive(filePath, drive.accessToken);
  } else {
    const admin = createAdminClient();
    await admin.storage.from(BUCKET).remove([filePath]);
  }

  revalidatePath("/pipeline");
  revalidatePath("/contacts");
  return {};
}

/**
 * Move one batch of pre-Drive files into Google Drive.
 *
 * Everything uploaded before the Drive hand-off existed sits in app
 * storage; this walks it into Drive exactly the way a fresh upload
 * goes -- into the lead's folder, with a category shortcut -- and
 * files already in Drive but missing their category shortcut get one.
 * Batched at twenty per call because a company's whole history will
 * not fit inside one serverless invocation; the Cloud Storage page
 * keeps calling until nothing is left.
 */
export async function backupFilesToDrive(): Promise<{
  error?: string;
  moved?: number;
  shortcutted?: number;
  docsSynced?: number;
  remaining?: number;
}> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  const { isAdminRole } = await import("@/lib/data/types");
  if (!isAdminRole(profile)) return { error: "Office or Admin only." };

  const drive = await getValidAccessToken(profile.company_id);
  if (!drive) return { error: "Google Drive isn't connected (or the connection expired)." };

  const admin = createAdminClient();
  const BATCH = 20;
  let moved = 0;
  let shortcutted = 0;

  // Pass 1: app-storage files that belong in Drive.
  const { data: pending } = await admin
    .from("lead_files")
    .select("id, lead_id, file_name, file_path, file_size, content_type")
    .eq("company_id", profile.company_id)
    .eq("storage_provider", "supabase")
    .lte("file_size", 30 * 1024 * 1024)
    .order("created_at", { ascending: true })
    .limit(BATCH)
    .returns<
      { id: string; lead_id: string; file_name: string; file_path: string; file_size: number; content_type: string | null }[]
    >();

  for (const f of pending ?? []) {
    const folderId = await getOrCreateLeadDriveFolder(f.lead_id, profile.company_id);
    if (!folderId) continue;
    const { data: blob } = await admin.storage.from(BUCKET).download(f.file_path);
    if (!blob) continue;
    const uploaded = await uploadBlobToDrive(
      f.file_name,
      blob,
      f.content_type || "application/octet-stream",
      drive.accessToken,
      folderId
    );
    if ("error" in uploaded) continue;
    const shortcutId = await fileCategoryShortcut(
      uploaded.id,
      f.file_name,
      f.content_type,
      drive.accessToken,
      drive.folderId
    );
    const { data: updated } = await admin
      .from("lead_files")
      .update({
        storage_provider: "google_drive",
        file_path: uploaded.id,
        file_url: uploaded.url,
        drive_shortcut_id: shortcutId,
      })
      .eq("id", f.id)
      .select("id");
    if (updated?.length) {
      await admin.storage.from(BUCKET).remove([f.file_path]);
      moved += 1;
    } else {
      // The row refused the update -- do not strand a Drive copy
      // nothing points at.
      await deleteFileFromDrive(uploaded.id, drive.accessToken);
    }
  }

  // Pass 2: Drive files from before the category view existed.
  const { data: unshortcutted } = await admin
    .from("lead_files")
    .select("id, file_name, file_path, content_type")
    .eq("company_id", profile.company_id)
    .eq("storage_provider", "google_drive")
    .is("drive_shortcut_id", null)
    .order("created_at", { ascending: true })
    .limit(BATCH)
    .returns<{ id: string; file_name: string; file_path: string; content_type: string | null }[]>();

  for (const f of unshortcutted ?? []) {
    const shortcutId = await fileCategoryShortcut(
      f.file_path,
      f.file_name,
      f.content_type,
      drive.accessToken,
      drive.folderId
    );
    if (!shortcutId) continue;
    await admin.from("lead_files").update({ drive_shortcut_id: shortcutId }).eq("id", f.id);
    shortcutted += 1;
  }

  // Pass 3: the documents themselves -- contracts and proposals
  // rendered to PDF and filed in their category folders.
  const docs = await backupDocumentsBatch(profile.company_id, drive.accessToken, drive.folderId);

  const { count: remainingSupabase } = await admin
    .from("lead_files")
    .select("id", { count: "exact", head: true })
    .eq("company_id", profile.company_id)
    .eq("storage_provider", "supabase")
    .lte("file_size", 30 * 1024 * 1024);
  const { count: remainingShortcuts } = await admin
    .from("lead_files")
    .select("id", { count: "exact", head: true })
    .eq("company_id", profile.company_id)
    .eq("storage_provider", "google_drive")
    .is("drive_shortcut_id", null);

  revalidatePath("/settings/cloud-storage");
  return {
    moved,
    shortcutted,
    docsSynced: docs.synced,
    remaining: (remainingSupabase ?? 0) + (remainingShortcuts ?? 0) + docs.remaining,
  };
}

/**
 * Which Drive category a document belongs to, and whether it needs a
 * (re)render. Signed anything -- contracts, change orders, completion
 * certificates -- is contract paperwork; a sellable document that has
 * been put in front of the customer but not signed is a proposal.
 * Drafts, declined and void documents stay out of the backup: they are
 * not paperwork anybody reaches for.
 */
export type BackupDocRow = {
  id: string;
  doc_number: string;
  kind: string | null;
  status: string;
  updated_at: string;
  drive_pdf_id: string | null;
  drive_pdf_synced_at: string | null;
};

function docCategory(row: Pick<BackupDocRow, "kind" | "status">): string | null {
  if (row.status === "Signed") return "Contracts";
  if ((row.kind ?? "contract") === "contract" && (row.status === "Sent" || row.status === "Viewed")) {
    return "Proposals";
  }
  return null;
}

function docNeedsSync(row: BackupDocRow): boolean {
  if (!docCategory(row)) return false;
  if (!row.drive_pdf_id || !row.drive_pdf_synced_at) return true;
  return new Date(row.updated_at).getTime() > new Date(row.drive_pdf_synced_at).getTime();
}

/**
 * Render one batch of documents to PDF and file them in Drive.
 *
 * Runs inside backupFilesToDrive's loop. Small batch: rendering plus a
 * Drive upload per document is the heaviest work the backup does. A
 * document edited after its last render is re-rendered and the stale
 * PDF replaced, so the Drive copy never quietly diverges from what the
 * customer signed or was sent.
 */
async function backupDocumentsBatch(
  companyId: string,
  accessToken: string,
  rootFolderId: string
): Promise<{ synced: number; remaining: number }> {
  const admin = createAdminClient();
  const { data: all, error } = await admin
    .from("estimates")
    .select("id, doc_number, kind, status, updated_at, drive_pdf_id, drive_pdf_synced_at")
    .eq("company_id", companyId)
    .order("created_at", { ascending: true })
    .returns<BackupDocRow[]>();
  // Before migration 0098 the columns don't exist; the file backup
  // still works, documents just wait.
  if (error || !all) return { synced: 0, remaining: 0 };

  const pending = all.filter(docNeedsSync);
  const batch = pending.slice(0, 5);
  let synced = 0;

  const { renderDocumentPdf } = await import("@/lib/pdf/document-pdf");

  for (const row of batch) {
    type EstimateRow = import("@/lib/data/types").Estimate & {
      parent_estimate_id?: string | null;
    };
    const [est, items, signers, payments, groups, companyRes] = await Promise.all([
      admin.from("estimates").select("*").eq("id", row.id).single<EstimateRow>(),
      admin
        .from("estimate_items")
        .select("*")
        .eq("estimate_id", row.id)
        .order("sort_order")
        .returns<import("@/lib/data/types").EstimateItem[]>(),
      admin
        .from("estimate_signers")
        .select("*")
        .eq("estimate_id", row.id)
        .order("sort_order")
        .returns<import("@/lib/data/types").EstimateSigner[]>(),
      admin
        .from("estimate_payments")
        .select("*")
        .eq("estimate_id", row.id)
        .order("sort_order")
        .returns<(import("@/lib/data/types").EstimatePayment & { cancelled_at?: string | null })[]>(),
      admin
        .from("estimate_groups")
        .select("*")
        .eq("estimate_id", row.id)
        .order("sort_order")
        .returns<import("@/lib/data/types").EstimateGroup[]>(),
      admin
        .from("company_profile")
        .select("name, address, phone, email, website, logo_url, license_number, license_state, license_type")
        .eq("company_id", companyId)
        .maybeSingle<{
          name: string | null; address: string | null; phone: string | null; email: string | null;
          website: string | null; logo_url: string | null; license_number: string | null;
          license_state: string | null; license_type: string | null;
        }>(),
    ]);
    const estimate = est.data;
    if (!estimate) continue;

    const { data: lead } = await admin
      .from("leads")
      .select("first_name, last_name, company_name, address, phone, email")
      .eq("id", estimate.lead_id)
      .maybeSingle<{
        first_name: string | null; last_name: string | null; company_name: string | null;
        address: string | null; phone: string | null; email: string | null;
      }>();
    const parent = estimate.parent_estimate_id
      ? (
          await admin
            .from("estimates")
            .select("doc_number, total_cents, signed_at")
            .eq("id", estimate.parent_estimate_id)
            .maybeSingle<{ doc_number: string; total_cents: number; signed_at: string | null }>()
        ).data
      : null;

    let bytes: Uint8Array;
    try {
      bytes = await renderDocumentPdf({
        estimate,
        items: items.data ?? [],
        signers: signers.data ?? [],
        payments: (payments.data ?? []).filter((p) => !p.cancelled_at),
        sections: groups.data ?? [],
        company: companyRes.data ?? null,
        customer: lead ?? null,
        parent: parent ?? null,
      });
    } catch {
      continue;
    }

    const category = docCategory(row);
    if (!category) continue;
    const folder = await getOrCreateCategoryFolder(category, accessToken, rootFolderId);
    if (!folder) continue;

    const customerName =
      lead?.company_name || [lead?.first_name, lead?.last_name].filter(Boolean).join(" ") || "";
    const pdfName = `${row.doc_number}${customerName ? " - " + customerName : ""}.pdf`.replace(
      /[\/:*?"<>|]/g,
      "-"
    );

    if (row.drive_pdf_id) await deleteFileFromDrive(row.drive_pdf_id, accessToken);
    const uploaded = await uploadBlobToDrive(
      pdfName,
      new Blob([Buffer.from(bytes)], { type: "application/pdf" }),
      "application/pdf",
      accessToken,
      folder
    );
    if ("error" in uploaded) continue;

    await admin
      .from("estimates")
      .update({ drive_pdf_id: uploaded.id, drive_pdf_synced_at: new Date().toISOString() })
      .eq("id", row.id);
    synced += 1;
  }

  return { synced, remaining: Math.max(0, pending.length - synced) };
}
