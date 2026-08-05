"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { isStrictAdmin } from "@/lib/data/types";

// Opening a lead, closing it and opening it again is one look, not three.
// Without this a rep flicking through the board would bury the trail in
// duplicates of themselves.
const COLLAPSE_MINUTES = 5;

export type LeadView = {
  id: string;
  userId: string;
  name: string;
  openedAt: string;
};

/**
 * Records that the signed-in user opened a lead. Fire-and-forget from the
 * UI: never surfaces an error, because failing to log a view must not
 * interrupt someone trying to work the lead.
 */
export async function recordLeadView(leadId: string): Promise<void> {
  const profile = await getCurrentProfile();
  if (!profile) return;

  const supabase = await createClient();
  const since = new Date(Date.now() - COLLAPSE_MINUTES * 60000).toISOString();

  const { data: recent } = await supabase
    .from("lead_views")
    .select("id")
    .eq("lead_id", leadId)
    .eq("user_id", profile.id)
    .gte("opened_at", since)
    .limit(1);
  if (recent && recent.length > 0) return;

  await supabase.from("lead_views").insert({
    lead_id: leadId,
    user_id: profile.id,
    company_id: profile.company_id,
  });
}

/**
 * The most recent opens of a lead, newest first. Admin role only -- this
 * reports on people, not on the lead.
 */
export async function getLeadViews(
  leadId: string,
  limit = 20
): Promise<{ error?: string; views?: LeadView[] }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isStrictAdmin(profile)) return { error: "Admin access required." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lead_views")
    .select("id, user_id, opened_at")
    .eq("lead_id", leadId)
    .order("opened_at", { ascending: false })
    .limit(limit);
  if (error) return { error: error.message };

  const rows = (data as { id: string; user_id: string; opened_at: string }[] | null) ?? [];
  if (rows.length === 0) return { views: [] };

  const { data: people } = await supabase
    .from("profiles")
    .select("id, name, email")
    .in("id", [...new Set(rows.map((r) => r.user_id))]);
  const byId = new Map(
    ((people as { id: string; name: string | null; email: string | null }[] | null) ?? []).map(
      (p) => [p.id, p.name || p.email || "Unknown"]
    )
  );

  return {
    views: rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      name: byId.get(r.user_id) ?? "Unknown",
      openedAt: r.opened_at,
    })),
  };
}
