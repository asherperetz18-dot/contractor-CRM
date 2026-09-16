import { NextResponse } from "next/server";
import { getActiveShares } from "@/lib/actions/screen-share";

/**
 * The screen-share discovery poll (who is sharing right now), as a
 * route handler rather than a Server Action, for the same reason as
 * /api/popup-alerts: every idle tab asks every 20 seconds, and the
 * action path re-runs the whole layout per ask. Auth is the action's
 * own -- caller's cookie session, RLS-scoped.
 */
export async function GET() {
  return NextResponse.json(await getActiveShares());
}
