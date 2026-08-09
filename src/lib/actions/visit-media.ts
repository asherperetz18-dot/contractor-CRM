"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";

export type VisitFile = {
  id: string;
  file_name: string;
  file_url: string | null;
  file_path: string | null;
  file_size: number | null;
  content_type: string | null;
  storage_provider: string | null;
  uploaded_by: string | null;
  created_at: string;
};

/**
 * Files captured on one specific visit.
 *
 * Read through the user's own session rather than the admin client, so
 * row-level security decides what they can see -- a rep must not be able
 * to pull photos from another company's job by guessing an event id.
 */
export async function getVisitMedia(
  eventId: string
): Promise<{ error?: string; files?: VisitFile[] }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lead_files")
    .select(
      "id, file_name, file_url, file_path, file_size, content_type, storage_provider, uploaded_by, created_at"
    )
    .eq("event_id", eventId)
    .eq("company_id", profile.company_id)
    .order("created_at", { ascending: false })
    .returns<VisitFile[]>();
  if (error) return { error: error.message };

  return { files: data ?? [] };
}
