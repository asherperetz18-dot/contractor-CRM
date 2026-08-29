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
export async function POST(req: NextRequest) {
  const cronSecret = getCronSecret();
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data } = await admin
    .from("company_profile")
    .select("company_id")
    .not("callrail_account_id", "is", null);

  const results: Record<string, { processed: number; created: number; error?: string }> = {};
  for (const row of (data as { company_id: string }[]) ?? []) {
    const r = await backfillCallRail(row.company_id, 2);
    results[row.company_id] = { processed: r.processed, created: r.created, ...(r.error ? { error: r.error } : {}) };
  }
  return NextResponse.json({ companies: Object.keys(results).length, results });
}
