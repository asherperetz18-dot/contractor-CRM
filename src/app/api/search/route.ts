import { NextResponse } from "next/server";
import { searchEverything } from "@/lib/actions/search";

/**
 * The topbar's "Search for Anything", as a route handler rather than a
 * Server Action. A search fires on every pause in typing, and Next runs
 * server actions through one queue in the browser -- so each pause
 * queued a search ahead of whatever the person clicked next, on every
 * page (DECISIONS #062). The action is unchanged and does its own auth
 * on the caller's cookie session; the SQL function it calls is
 * SECURITY INVOKER, so RLS still scopes every hit.
 *
 * A search that could not be run at all (both the SQL function and the
 * filter fallback failed) answers 503, so the topbar says so instead of
 * reporting "no matches" for records that exist.
 */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  const groups = await searchEverything(q);
  if (groups === null) {
    return NextResponse.json({ error: "search unavailable" }, { status: 503 });
  }
  return NextResponse.json({ groups });
}
