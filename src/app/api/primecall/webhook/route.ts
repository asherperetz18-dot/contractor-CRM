import { NextRequest, NextResponse, after } from "next/server";
import { getPrimeCallForCompany } from "@/lib/primecall-company";
import { tokenMatches } from "@/lib/primecall";
import { syncPrimeCall } from "@/lib/primecall-sync";

/**
 * Where PrimeCall (NetSapiens) posts a CDR each time a call leg ends.
 *
 * The URL carries ?c=<our company uuid>&t=<secret made at connect>. The
 * post itself is only a nudge: rather than trusting and decoding the
 * body, a verified nudge re-reads the last half hour of calls from the
 * API -- the same authoritative read the 15-minute sweep does -- so a
 * forged or oddly-shaped post can never write anything.
 */
export async function POST(req: NextRequest) {
  const companyId = req.nextUrl.searchParams.get("c");
  const token = req.nextUrl.searchParams.get("t");
  if (!companyId || !token) return NextResponse.json({ error: "Missing ?c= or ?t=" }, { status: 400 });

  const creds = await getPrimeCallForCompany(companyId);
  if (!creds || !tokenMatches(token, creds.webhookToken)) {
    return NextResponse.json({ error: "Unknown hook." }, { status: 401 });
  }

  // Answered at once -- NetSapiens counts slow answers as errors -- and
  // the read runs after. The short wait lets the other legs of the same
  // call finish writing their CDRs, so one read files the whole call.
  after(async () => {
    await new Promise((r) => setTimeout(r, 5_000));
    const result = await syncPrimeCall(companyId, 30).catch((e) => ({ error: String(e) }));
    if ("error" in result && result.error) console.error("[primecall] webhook sync failed", result.error);
  });
  return NextResponse.json({ ok: true });
}
