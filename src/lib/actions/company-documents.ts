"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { isAdminRole } from "@/lib/data/types";
import { COMPANY_DOC_KINDS, type CompanyDocKind } from "@/lib/data/company-docs";

const BUCKET = "company-docs";
const MAX_BYTES = 15 * 1024 * 1024;

export type CompanyDocument = {
  id: string;
  kind: CompanyDocKind;
  title: string;
  file_name: string;
  file_path: string;
  file_url: string;
  content_type: string | null;
  file_size: number | null;
  expires_on: string | null;
  show_on_portal: boolean;
  created_at: string;
};

export async function getCompanyDocuments(): Promise<{
  error?: string;
  documents?: CompanyDocument[];
}> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_documents")
    .select(
      "id, kind, title, file_name, file_path, file_url, content_type, file_size, expires_on, show_on_portal, created_at"
    )
    .eq("company_id", profile.company_id)
    .order("kind", { ascending: true })
    .order("created_at", { ascending: false })
    .returns<CompanyDocument[]>();
  if (error) return { error: error.message };
  return { documents: data ?? [] };
}

export async function uploadCompanyDocument(form: FormData): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "Only Office or Admin users can upload these." };

  const file = form.get("file") as File | null;
  const title = String(form.get("title") ?? "").trim();
  const kind = String(form.get("kind") ?? "license") as CompanyDocKind;
  const expiresOn = String(form.get("expires_on") ?? "").trim();
  const showOnPortal = form.get("show_on_portal") === "on";

  if (!file || file.size === 0) return { error: "Choose a file to upload." };
  if (!title) return { error: "Give the document a name." };
  if (!COMPANY_DOC_KINDS.some((k) => k.value === kind)) return { error: "Unknown document type." };
  if (file.size > MAX_BYTES) return { error: "That file is over 15MB." };

  const admin = createAdminClient();
  // Namespaced by company so one contractor's certificates can never
  // collide with another's, whatever they call the file.
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${profile.company_id}/${Date.now()}-${safeName}`;

  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type || undefined });
  if (uploadError) return { error: uploadError.message };

  const {
    data: { publicUrl },
  } = admin.storage.from(BUCKET).getPublicUrl(path);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_documents")
    .insert({
      company_id: profile.company_id,
      kind,
      title,
      file_name: file.name,
      file_path: path,
      file_url: publicUrl,
      content_type: file.type || null,
      file_size: file.size,
      expires_on: expiresOn || null,
      show_on_portal: showOnPortal,
      uploaded_by: profile.id,
    })
    .select("id");
  if (error) return { error: error.message };
  // Row count rather than a missing error: an RLS-blocked insert would
  // otherwise leave the file in the bucket and report success.
  if (!data?.length) {
    await admin.storage.from(BUCKET).remove([path]);
    return { error: "Couldn't save that document." };
  }

  revalidatePath("/settings/certificates");
  return {};
}

export async function setCompanyDocumentVisible(
  id: string,
  visible: boolean
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "Only Office or Admin users can do that." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_documents")
    .update({ show_on_portal: visible })
    .eq("id", id)
    .eq("company_id", profile.company_id)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Couldn't update that document." };
  revalidatePath("/settings/certificates");
  return {};
}

export async function deleteCompanyDocument(id: string): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "Only Office or Admin users can do that." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_documents")
    .delete()
    .eq("id", id)
    .eq("company_id", profile.company_id)
    .select("file_path")
    .returns<{ file_path: string }[]>();
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Couldn't delete that document." };

  // The row goes first. A file left in the bucket is invisible clutter; a
  // row pointing at a deleted file is a broken link on a customer's page.
  await createAdminClient().storage.from(BUCKET).remove([data[0].file_path]);
  revalidatePath("/settings/certificates");
  return {};
}
