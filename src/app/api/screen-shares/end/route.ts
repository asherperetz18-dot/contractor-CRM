import { NextResponse } from "next/server";
import { endScreenShare } from "@/lib/actions/screen-share";
import { shareIdFromEndRequest } from "@/lib/screen-share-session";

/**
 * A sharer's goodbye: ends their session the moment they Stop, reload
 * or close the tab. The browser sends it with sendBeacon, which still
 * goes out while the page is going away -- the Server Action this
 * replaced was abandoned with the page (or stuck behind another action
 * in the queue), so the row stayed "live" and its invite popped up on
 * the teammate's screen at every refresh for up to 4 hours.
 *
 * Auth is the action's own: the caller's cookie session, and only the
 * sharer can end their session (the update is scoped to sharer_id, and
 * RLS holds the same line).
 */
export async function POST(request: Request) {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    // not JSON -- nothing to end
  }
  const id = shareIdFromEndRequest(body);
  if (id) await endScreenShare(id);
  // Nothing to say back. The caller is a beacon and is not listening.
  return new NextResponse(null, { status: 204 });
}
