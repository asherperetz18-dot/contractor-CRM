import { NextResponse } from "next/server";
import { getNotifications } from "@/lib/actions/notifications";

/**
 * The bell's feed, as a route handler rather than a Server Action, for
 * the same reason as /api/popup-alerts: it is polled by every open tab,
 * and the action path re-runs the whole layout per ask. Auth is the
 * action's own -- caller's cookie session, RLS-scoped.
 */
export async function GET() {
  return NextResponse.json(await getNotifications());
}
