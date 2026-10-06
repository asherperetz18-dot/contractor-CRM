import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { refuseCronCaller } from "@/lib/cron-auth";
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
  // The database's scheduler or a CRON_SECRET holder (DECISIONS #140).
  const refused = await refuseCronCaller(req);
  if (refused) return refused;

  const finalized = await sweepReceptionistCalls(createAdminClient());
  return NextResponse.json({ finalized });
}

export const POST = withRouteObservability("api.cron.ai-receptionist-finalize", handlePost);
