import { createClient } from "@/lib/supabase/server";
import type { ActivityEvent, Profile } from "@/lib/data/types";
import { AdminGate } from "@/components/admin-gate";
import { TeamActivityView } from "./team-activity-view";

function ninetyDaysAgoISO(): string {
  return new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
}

export default async function TeamActivityPage() {
  const supabase = await createClient();
  const since = ninetyDaysAgoISO();

  const [{ data: events }, { data: users }] = await Promise.all([
    supabase
      .from("activity_events")
      .select("id, user_id, session_id, path, kind, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: true }),
    supabase
      .from("profiles")
      .select("id, name, email, roles, status, can_delete_leads, created_at"),
  ]);

  return (
    <AdminGate>
      <TeamActivityView
        events={(events as ActivityEvent[]) ?? []}
        users={(users as Profile[]) ?? []}
      />
    </AdminGate>
  );
}
