import { NextRequest, NextResponse } from "next/server";
import { getCronSecret } from "@/lib/cron-env";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncPrimeCall } from "@/lib/primecall-sync";
import { withRouteObservability } from "@/lib/observability/observe";

/**
 * Scheduled re-read of recent PrimeCall calls for every connected
 * company -- the floor under the live feed, and the whole feed for an
 * account whose PrimeCall plan doesn't allow event subscriptions.
 * Same cron secret as the other scheduled jobs.
 */
export const maxDuration = 300;

async function handlePost(req: NextRequest) {
  const cronSecret = getCronSecret();
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // The scheduled sweep re-reads 3 hours; a manual dispatch can ask for
  // days of history, which is imported without new-lead texts.
  const days = Number(req.nextUrl.searchParams.get("days")) || 0;
  const minutes = days > 0 ? Math.min(60, days) * 24 * 60 : 180;

  const admin = createAdminClient();
  const { data } = await admin
    .from("company_profile")
    .select("company_id")
    .not("primecall_domain", "is", null);

  const results: Record<string, { processed: number; created: number; error?: string }> = {};
  for (const row of (data as { company_id: string }[]) ?? []) {
    const r = await syncPrimeCall(row.company_id, minutes, { quiet: days > 0 });
    results[row.company_id] = { processed: r.processed, created: r.created, ...(r.error ? { error: r.error } : {}) };
  }
  return NextResponse.json({ minutes, companies: Object.keys(results).length, results });
}

export const POST = withRouteObservability("api.cron.primecall-sync", handlePost);
