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

const MAX_SUPABASE_FILE_BYTES = 1500 * 1024;
const MAX_DRIVE_FILE_BYTES = 20 * 1024 * 1024;
const BUCKET = "lead-files";

export async function uploadLeadFile(
  leadId: string,
  formData: FormData
): Promise<{ error?: string }> {
  const file = formData.get("file");
  if (!(file instanceof File) || !file.name) return { error: "No file selected." };

  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  const drive = await getValidAccessToken(profile.company_id);

  if (drive) {
    if (file.size > MAX_DRIVE_FILE_BYTES) {
      return { error: "File is too large — please use one under 20MB." };
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
      company_id: profile.company_id,
    });
    if (error) return { error: error.message };

    revalidatePath("/pipeline");
    revalidatePath("/contacts");
    return {};
  }

  if (file.size > MAX_SUPABASE_FILE_BYTES) {
    return { error: "File is too large — please use one under 1500KB, or connect Google Drive in Settings for larger files." };
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
    company_id: profile.company_id,
  });
  if (error) return { error: error.message };

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
