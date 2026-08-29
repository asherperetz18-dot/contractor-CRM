import { NextRequest, NextResponse } from "next/server";
import { getCronSecret } from "@/lib/cron-env";
import { createAdminClient } from "@/lib/supabase/admin";
import { backfillCallRail } from "@/lib/callrail-sync";

/**
 * Scheduled re-pull of recent CallRail calls for every connected
 * company. CallRail does not retry a failed webhook delivery, so this
 * sweep is what guarantees no tracked call is lost to a deploy moment
 * or a network blip. Same cron secret as the other scheduled jobs.
 */
// A deep historical sweep (?days=90) walks thousands of calls; the
// default serverless budget cuts it off mid-import.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const cronSecret = getCronSecret();
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // The scheduled sweep uses the 2-day default; a manual dispatch can
  // ask for deeper history.
  const days = Math.min(120, Math.max(1, Number(req.nextUrl.searchParams.get("days")) || 2));

  const admin = createAdminClient();
  const { data } = await admin
    .from("company_profile")
    .select("company_id")
    .not("callrail_account_id", "is", null);

  const results: Record<string, { processed: number; created: number; error?: string }> = {};
  for (const row of (data as { company_id: string }[]) ?? []) {
    const r = await backfillCallRail(row.company_id, days);
    results[row.company_id] = { processed: r.processed, created: r.created, ...(r.error ? { error: r.error } : {}) };
  }
  return NextResponse.json({ days, companies: Object.keys(results).length, results });
}
