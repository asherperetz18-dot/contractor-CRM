import { NextResponse } from "next/server";
import { getLiveUsers } from "@/lib/actions/presence";

/**
 * Who's online, for the presence panel's once-a-minute refresh while
 * it is open. The layout still seeds the badge for free; only the
 * refresh moved here, off the action queue every other poll already
 * left (DECISIONS #029, #060). The action does its own admin check on
 * the caller's cookie session.
 */
export async function GET() {
  return NextResponse.json(await getLiveUsers());
}
