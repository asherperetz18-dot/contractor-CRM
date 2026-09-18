import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCronSecret } from "@/lib/cron-env";
import { sweepReceptionistCalls } from "@/lib/ai-receptionist-engine";
import { withRouteObservability } from "@/lib/observability/observe";

/**
 * The finalize floor for AI receptionist calls. The clean goodbye path
 * files its records via after() in the turn webhook, and every inbound
 * call sweeps stragglers -- this cron only guarantees that a caller who
 * hung up mid-conversation on a quiet line still becomes a lead within
 * a couple of hours, not never.
 */
async function handlePost(req: NextRequest) {
  const cronSecret = getCronSecret();
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const finalized = await sweepReceptionistCalls(createAdminClient());
  return NextResponse.json({ finalized });
}

export const POST = withRouteObservability("api.cron.ai-receptionist-finalize", handlePost);
