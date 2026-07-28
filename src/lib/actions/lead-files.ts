"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const BUCKET = "lead-files";

export async function uploadLeadFile(
  leadId: string,
  formData: FormData
): Promise<{ error?: string }> {
  const file = formData.get("file");
  if (!(file instanceof File) || !file.name) return { error: "No file selected." };
  if (file.size > MAX_FILE_BYTES) {
    return { error: "File is too large — please use one under 20MB." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

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
    uploaded_by: user.id,
    file_name: file.name,
    file_path: path,
    file_url: publicUrl,
    file_size: file.size,
    content_type: file.type || null,
  });
  if (error) return { error: error.message };

  revalidatePath("/pipeline");
  revalidatePath("/contacts");
  return {};
}

export async function deleteLeadFile(id: string, filePath: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.from("lead_files").delete().eq("id", id);
  if (error) return { error: error.message };

  const admin = createAdminClient();
  await admin.storage.from(BUCKET).remove([filePath]);

  revalidatePath("/pipeline");
  revalidatePath("/contacts");
  return {};
}
