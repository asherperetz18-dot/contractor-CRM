import { NextResponse } from "next/server";
import { getPopupAlerts } from "@/lib/actions/popup-alerts";

/**
 * What the popup watcher polls, as a route handler rather than a Server
 * Action. The watcher asks every 20 seconds on every open tab, and a
 * Server Action is not a cheap way to ask: it runs the whole request
 * pipeline -- proxy, session, layout -- and queues behind (and ahead
 * of) the user's own clicks, about a second and a half each (see
 * live-users-button.tsx and /api/activity/ping, which each left the
 * action path for exactly this reason). As a route it does the reads
 * and nothing else. The action itself is unchanged and does its own
 * auth: it runs on the caller's cookie session, so RLS and the role
 * checks scope the answer exactly as before.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const res = await getPopupAlerts({
    textsSince: url.searchParams.get("textsSince"),
    eventsSince: url.searchParams.get("eventsSince"),
  });
  return NextResponse.json(res);
}
