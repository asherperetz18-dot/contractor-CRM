import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { refuseCronCaller } from "@/lib/cron-auth";
import { withRouteObservability } from "@/lib/observability/observe";
import { listConnections, syncConnection } from "@/lib/google-calendar/sync";
import { runForEachCompany, runSummary } from "@/lib/cron/run-companies";

/**
 * Every 15 minutes: pull then push for every connected Google calendar
 * on the platform. One connection failing (an expired token, a Google
 * hiccup) is recorded on its own row and never stops the others.
 */
async function handlePost(req: NextRequest) {
  // The database's scheduler or a CRON_SECRET holder (DECISIONS #140).
  const refused = await refuseCronCaller(req);
  if (refused) return refused;

  const admin = createAdminClient();
  const connections = await listConnections(admin);
  const totals = { connections: connections.length, created: 0, updated: 0, removed: 0, pulled: 0, failed: 0 };
  // Each connection in its own safety net (DECISIONS #126): Google
  // refusing one company's token doesn't stop everyone else's sync.
  const run = await runForEachCompany("api.cron.google-calendar-sync", connections, (c) => c.id, async (conn) => {
    const s = await syncConnection(admin, conn);
    totals.created += s.created;
    totals.updated += s.updated;
    totals.removed += s.removed;
    totals.pulled += s.pulled;
    if (s.error) totals.failed += 1;
  }, { companyOf: (c) => c.company_id });
  return NextResponse.json({ ...totals, ...runSummary(run) });
}

// Room for every company's turn (runForEachCompany stops starting new
// ones at CRON_BUDGET_MS, before this limit).
export const maxDuration = 300;

export const POST = withRouteObservability("api.cron.google-calendar-sync", handlePost);
