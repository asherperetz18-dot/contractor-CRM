import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";

/**
 * Where the app records that somebody is using it.
 *
 * This was a Server Action, and a Server Action is not a cheap way to
 * write one analytics row. It posts into the current route, so it runs
 * the whole request pipeline -- proxy, session, layout -- and answers
 * with a React payload the caller throws away. Measured against a real
 * session it cost around 600ms, and it fired on every navigation, in
 * parallel with the page the person was actually waiting for. On a plan
 * with limited concurrency that is not merely waste; it is a competitor.
 *
 * As a route handler it is outside the proxy's matcher and returns no
 * payload, so it does its insert and nothing else. The browser sends it
 * with sendBeacon, which does not block navigation and survives the page
 * going away -- which is also a small correctness win, since a ping used
 * to be abandoned when someone clicked away quickly.
 *
 * Runs as the signed-in user, so the insert passes the same row-security
 * check it did as an action: activity_events accepts a row only when
 * user_id is the caller.
 */
export async function POST(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return new NextResponse(null, { status: 204 });

  let body: { sessionId?: unknown; path?: unknown; kind?: unknown };
  try {
    body = await request.json();
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  const path = typeof body.path === "string" ? body.path : "";
  const kind = body.kind === "heartbeat" ? "heartbeat" : "pageview";
  if (!sessionId || !path) return new NextResponse(null, { status: 204 });

  const supabase = await createClient();
  await supabase.from("activity_events").insert({
    user_id: profile.id,
    session_id: sessionId,
    path,
    kind,
    company_id: profile.company_id,
  });

  // Nothing to say back. The caller is a beacon and is not listening.
  return new NextResponse(null, { status: 204 });
}
