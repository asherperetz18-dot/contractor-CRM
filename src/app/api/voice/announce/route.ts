import { NextRequest, NextResponse } from "next/server";
import { getTwilioEnv, validateTwilioSignature } from "@/lib/twilio-env";
import { companyForAccountSid, getTwilioForCompany } from "@/lib/twilio-company";
import { recordingNoticeSay } from "@/lib/voice-notice";

/**
 * The recording notice, played to the person being called.
 *
 * Attached to <Number> rather than sitting before <Dial>, because TwiML
 * on the <Number> runs on the *called* leg. A <Say> before the <Dial>
 * would announce the recording to the rep who already knows, and leave
 * the homeowner -- the only person whose consent is required -- hearing
 * nothing at all.
 *
 * This is not a whisper. A whisper reaches one party by design; a
 * recording notice is worthless unless it reaches the party being
 * recorded.
 *
 * The rep hears ringing throughout: <Dial answerOnBridge="true"> holds
 * them on ringback until this finishes, so nobody sits through the
 * message twice a day.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) params[key] = String(value);

  const companyId = await companyForAccountSid(params.AccountSid || "");
  const twilioEnv = companyId ? await getTwilioForCompany(companyId) : getTwilioEnv();

  // No credentials means no signature to verify against. Answering with
  // the notice anyway is the safe failure: the alternative is a call
  // that connects without one, which is the exact situation the notice
  // exists to prevent.
  if (twilioEnv) {
    const signature = req.headers.get("x-twilio-signature");
    if (!validateTwilioSignature(req.url, params, signature, twilioEnv.authToken)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
    }
  }

  return new NextResponse(
    `<?xml version="1.0" encoding="UTF-8"?><Response>${recordingNoticeSay()}</Response>`,
    { status: 200, headers: { "Content-Type": "text/xml" } }
  );
}
