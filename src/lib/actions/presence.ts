"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import { isStrictAdmin } from "@/lib/data/types";

// The tracker heartbeats every 30s, and only while the tab is visible and
// the person has interacted in the last minute. So a ping inside the last
// couple of minutes means someone is genuinely at the keyboard, and pings
// that stopped a few minutes ago mean they're still signed in but have
// wandered off -- which is exactly the active/away split.
const ACTIVE_WINDOW_MS = 2 * 60 * 1000;
const AWAY_WINDOW_MS = 15 * 60 * 1000;

export type PresenceUser = {
  id: string;
  name: string;
  status: "active" | "away";
  lastSeenMinutes: number;
};

export async function getLiveUsers(): Promise<{
  error?: string;
  users?: PresenceUser[];
}> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  // Same bar as Team Activity: knowing who is at their desk is a
  // management view, not something every teammate needs about everyone.
  if (!isStrictAdmin(profile)) return { error: "Admin access required." };

  const supabase = await createClient();
  const since = new Date(Date.now() - AWAY_WINDOW_MS).toISOString();

  // A 15-minute slice of a table that holds ~19k rows overall, so this
  // stays small without paging. Ordered newest-first so the first row
  // seen for a user is their latest.
  const { data, error } = await supabase
    .from("activity_events")
    .select("user_id, created_at")
    .eq("company_id", profile.company_id)
    .gte("created_at", since)
    .order("created_at", { ascending: false });
  if (error) return { error: error.message };

  const latest = new Map<string, number>();
  for (const row of (data as { user_id: string; created_at: string }[] | null) ?? []) {
    if (!latest.has(row.user_id)) latest.set(row.user_id, new Date(row.created_at).getTime());
  }

  const members = await getCompanyMembers(profile.company_id);
  const now = Date.now();
  const users: PresenceUser[] = [];
  for (const [userId, seenAt] of latest) {
    const member = members.find((m) => m.id === userId);
    if (!member) continue;
    const age = now - seenAt;
    users.push({
      id: userId,
      name: member.name || member.email || "Unknown",
      status: age <= ACTIVE_WINDOW_MS ? "active" : "away",
      lastSeenMinutes: Math.max(0, Math.round(age / 60000)),
    });
  }

  users.sort((a, b) => {
    if (a.status !== b.status) return a.status === "active" ? -1 : 1;
    return a.lastSeenMinutes - b.lastSeenMinutes;
  });

  return { users };
}
