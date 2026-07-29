import { createClient } from "@/lib/supabase/server";
import type { ActivityEvent } from "@/lib/data/types";
import { getCurrentCompanyId } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import { AdminGate } from "@/components/admin-gate";
import { TeamActivityView } from "./team-activity-view";

function ninetyDaysAgoISO(): string {
  return new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
}

// Supabase/PostgREST caps every query at this project's configured max rows
// (1000), regardless of .range(). A single 90-day fetch of heartbeat pings
// blows past that quickly, and since it was sorted ascending, the cap was
// silently dropping every recent event -- the newest activity never made it
// to the page. Page through in descending order (most recent first) so if
// the safety cap below is ever hit, it's old data that gets dropped, not
// today's.
const PAGE_SIZE = 1000;
const MAX_ROWS = 20000;

async function fetchAllActivityEvents(
  supabase: Awaited<ReturnType<typeof createClient>>,
  since: string,
  companyId: string
): Promise<ActivityEvent[]> {
  const rows: ActivityEvent[] = [];
  let offset = 0;
  while (offset < MAX_ROWS) {
    const { data, error } = await supabase
      .from("activity_events")
      .select("id, user_id, session_id, path, kind, created_at")
      .eq("company_id", companyId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error || !data || data.length === 0) break;
    rows.push(...(data as ActivityEvent[]));
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return rows;
}

export default async function TeamActivityPage() {
  const supabase = await createClient();
  const since = ninetyDaysAgoISO();

  const companyId = await getCurrentCompanyId();
  const [events, users] = await Promise.all([
    companyId ? fetchAllActivityEvents(supabase, since, companyId) : Promise.resolve([]),
    companyId ? getCompanyMembers(companyId) : Promise.resolve([]),
  ]);

  return (
    <AdminGate>
      <TeamActivityView events={events} users={users} />
    </AdminGate>
  );
}
