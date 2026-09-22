import { NextResponse } from "next/server";
import { searchEverything } from "@/lib/actions/search";

/**
 * The topbar's "Search for Anything", as a route handler rather than a
 * Server Action. A search fires on every pause in typing, and Next runs
 * server actions through one queue in the browser -- so each pause
 * queued a search ahead of whatever the person clicked next, on every
 * page (DECISIONS #060). The action is unchanged and does its own auth
 * on the caller's cookie session; the SQL function it calls is
 * SECURITY INVOKER, so RLS still scopes every hit.
 */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  const groups = await searchEverything(q);
  return NextResponse.json({ groups });
}
