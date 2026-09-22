import { NextResponse } from "next/server";
import { getLeadMessages, getRepMessages } from "@/lib/actions/sms";

/**
 * A lead card's text thread -- the customer conversation and the rep
 * traffic on the same job -- as a route handler rather than a Server
 * Action. The Texts tab polls this every 12 seconds while it is open,
 * and Next runs server actions through one queue in the browser: a
 * poll on the action path put the user's own Send behind it, every
 * twelve seconds (DECISIONS #029, #060). As a route it does the reads
 * and nothing else. The actions themselves are unchanged and do their
 * own auth on the caller's cookie session, so RLS scopes the answer
 * exactly as before.
 */
export async function GET(request: Request) {
  const leadId = new URL(request.url).searchParams.get("leadId");
  if (!leadId) return NextResponse.json({ error: "Missing leadId." }, { status: 400 });
  const [lead, rep] = await Promise.all([getLeadMessages(leadId), getRepMessages(leadId)]);
  return NextResponse.json({ lead, rep });
}
