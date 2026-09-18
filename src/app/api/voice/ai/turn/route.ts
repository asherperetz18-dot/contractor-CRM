import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTwilioEnv, validateTwilioSignature } from "@/lib/twilio-env";
import { companyForAccountSid, companyForInboundNumber, getTwilioForCompany } from "@/lib/twilio-company";
import {
  failsafeTwiml,
  finalizeReceptionistCall,
  runReceptionistTurn,
} from "@/lib/ai-receptionist-engine";

/**
 * One turn of the AI receptionist: Twilio's <Gather> posts what the
 * caller said, this answers with what the AI says next (or a goodbye).
 * Signature-validated per company like every other voice webhook; when
 * the reply ends the call, the CRM records are filed via after() so the
 * goodbye reaches the caller without waiting on the paperwork.
 */

// A turn is one short model reply, but the line is live -- headroom
// over the default beats clipping a slow turn mid-call.
export const maxDuration = 30;

function twiml(body: string): NextResponse {
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) params[key] = String(value);

  // Same two-step resolution as the dial-status callback: the account
  // that signed it, else the number that was called.
  const companyId =
    (await companyForAccountSid(params.AccountSid || "")) ??
    (await companyForInboundNumber(params.To || ""));
  const twilioEnv = companyId ? await getTwilioForCompany(companyId) : getTwilioEnv();
  if (!twilioEnv) return twiml(failsafeTwiml());

  const signature = req.headers.get("x-twilio-signature");
  if (!validateTwilioSignature(req.url, params, signature, twilioEnv.authToken)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  const admin = createAdminClient();
  const result = await runReceptionistTurn(admin, {
    callSid: (params.CallSid || "").trim(),
    speech: params.SpeechResult || "",
    origin: new URL(req.url).origin,
  });

  if (result.finalizeSessionId) {
    const sessionId = result.finalizeSessionId;
    after(async () => {
      try {
        await finalizeReceptionistCall(createAdminClient(), sessionId);
      } catch (error) {
        console.error("[ai-receptionist] finalize after goodbye failed", sessionId, error);
      }
    });
  }

  return twiml(result.body);
}
