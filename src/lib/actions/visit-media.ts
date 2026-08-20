"use server";

import { createAdminClient } from "@/lib/supabase/admin";
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
 * The boundary is the company, checked against the events table: a rep
 * must not pull photos from another company's job by guessing an event
 * id, but a sales-scoped rep looking at their own visit -- on a
 * customer their lead-list RLS hides -- must see what was taken there.
 * Photos of a visit belong to whoever can open the visit.
 */
export async function getVisitMedia(
  eventId: string
): Promise<{ error?: string; files?: VisitFile[] }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const admin = createAdminClient();
  const { data: event } = await admin
    .from("events")
    .select("id")
    .eq("id", eventId)
    .eq("company_id", profile.company_id)
    .maybeSingle<{ id: string }>();
  if (!event) return { error: "That appointment isn't available." };

  const { data, error } = await admin
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
