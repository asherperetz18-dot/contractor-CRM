import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/crypto/secrets";
import { parseStoredList } from "@/lib/callrail-company";
import {
  processCallRailCall,
  processCallRailForm,
  processCallRailText,
  type CallRailCall,
  type CallRailForm,
  type CallRailText,
} from "@/lib/callrail-sync";

/**
 * Where CallRail delivers finished calls, form fills, and inbound texts.
 *
 * The URL carries ?c=<our company uuid> to say whose data this is, but
 * the uuid proves nothing on its own -- authenticity comes from the
 * Signature header: Base64(HMAC-SHA1(per-company signing key, raw
 * body)), computed by CallRail and recomputed here. The raw body must be
 * read as text BEFORE parsing; any re-serialization would change bytes
 * and break the comparison.
 */
export async function POST(req: NextRequest) {
  const companyId = req.nextUrl.searchParams.get("c");
  const kind = req.nextUrl.searchParams.get("kind") ?? "call";
  if (!companyId) return NextResponse.json({ error: "Missing ?c=" }, { status: 400 });

  const admin = createAdminClient();
  const { data } = await admin
    .from("company_profile")
    .select("callrail_signing_key_enc")
    .eq("company_id", companyId)
    .maybeSingle<{ callrail_signing_key_enc: string | null }>();
  // One key per tracked CallRail company; the delivery is genuine if
  // any of them verifies it -- CallRail does not say which company a
  // webhook is for except through its signature.
  const signingKeys = parseStoredList(decryptSecret(data?.callrail_signing_key_enc ?? null));
  if (!signingKeys.length) {
    return NextResponse.json({ error: "CallRail is not connected." }, { status: 401 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("signature") ?? "";
  const a = Buffer.from(signature);
  const verified = signingKeys.some((key) => {
    const b = Buffer.from(crypto.createHmac("sha1", key).update(rawBody).digest("base64"));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
  if (!verified) {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Not JSON" }, { status: 400 });
  }

  try {
    const result =
      kind === "form"
        ? await processCallRailForm(admin, companyId, payload as CallRailForm)
        : kind === "sms"
          ? await processCallRailText(admin, companyId, payload as CallRailText)
          : await processCallRailCall(admin, companyId, payload as CallRailCall);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    // CallRail never retries, but repeated 5xx can auto-disable the
    // whole integration -- so the error is logged and answered 200.
    console.error("callrail webhook failed", e);
    return NextResponse.json({ ok: false });
  }
}
