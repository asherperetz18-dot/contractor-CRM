import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTwilioEnv, validateTwilioSignature } from "@/lib/twilio-env";
import { companyForAccountSid, companyForInboundNumber, getTwilioForCompany } from "@/lib/twilio-company";
import {
  failsafeTwiml,
  finalizeReceptionistCall,
  handleTransferResult,
} from "@/lib/ai-receptionist-engine";

/**
 * Where the transfer <Dial> reports back. A human answered: the call is
 * over, file it. Nobody answered: the AI picks the caller back up — a
 * failed transfer must never be a dead line.
 */

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
  const result = await handleTransferResult(admin, {
    callSid: (params.CallSid || "").trim(),
    dialStatus: (params.DialCallStatus || "").trim(),
    origin: new URL(req.url).origin,
  });

  if (result.finalizeSessionId) {
    const sessionId = result.finalizeSessionId;
    after(async () => {
      try {
        await finalizeReceptionistCall(createAdminClient(), sessionId);
      } catch (error) {
        console.error("[ai-receptionist] finalize after transfer failed", sessionId, error);
      }
    });
  }

  return twiml(result.body);
}
