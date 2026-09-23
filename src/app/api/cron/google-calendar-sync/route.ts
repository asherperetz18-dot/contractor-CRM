import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCronSecret } from "@/lib/cron-env";
import { withRouteObservability } from "@/lib/observability/observe";
import { listConnections, syncConnection } from "@/lib/google-calendar/sync";

/**
 * Every 15 minutes: pull then push for every connected Google calendar
 * on the platform. One connection failing (an expired token, a Google
 * hiccup) is recorded on its own row and never stops the others.
 */
async function handlePost(req: NextRequest) {
  const cronSecret = getCronSecret();
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const connections = await listConnections(admin);
  const totals = { connections: connections.length, created: 0, updated: 0, removed: 0, pulled: 0, failed: 0 };
  for (const conn of connections) {
    const s = await syncConnection(admin, conn);
    totals.created += s.created;
    totals.updated += s.updated;
    totals.removed += s.removed;
    totals.pulled += s.pulled;
    if (s.error) totals.failed += 1;
  }
  return NextResponse.json(totals);
}

export const POST = withRouteObservability("api.cron.google-calendar-sync", handlePost);
