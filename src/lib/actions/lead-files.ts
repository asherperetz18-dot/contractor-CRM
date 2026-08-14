"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import {
  deleteFileFromDrive,
  getOrCreateLeadDriveFolder,
  getValidAccessToken,
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

  // The lead is read as the signed-in user, so a rep cannot get an
  // upload URL for a colleague's customer just by knowing the id.
  const supabase = await createClient();
  const { data: lead } = await supabase
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
export async function recordLeadFile(
  leadId: string,
  path: string,
  fileName: string,
  fileSize: number,
  contentType: string | null,
  eventId?: string | null
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!path.startsWith(`${leadId}/`)) return { error: "That upload doesn't belong here." };

  const admin = createAdminClient();
  const slash = path.lastIndexOf("/");
  const { data: found } = await admin.storage
    .from(BUCKET)
    .list(path.slice(0, slash), { search: path.slice(slash + 1) });
  if (!found?.length) return { error: "That upload didn't finish. Please try again." };

  const {
    data: { publicUrl },
  } = admin.storage.from(BUCKET).getPublicUrl(path);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lead_files")
    .insert({
      lead_id: leadId,
      uploaded_by: profile.id,
      file_name: fileName,
      file_path: path,
      file_url: publicUrl,
      file_size: fileSize,
      content_type: contentType,
      storage_provider: "supabase",
      event_id: eventId ?? null,
      company_id: profile.company_id,
    })
    .select("id");
  if (error) return { error: error.message };
  // A blocked insert matches zero rows without erroring, which would
  // leave the object in storage and nothing pointing at it.
  if (!data?.length) {
    await admin.storage.from(BUCKET).remove([path]);
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
  const { error } = await supabase.from("lead_files").delete().eq("id", id);
  if (error) return { error: error.message };

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
