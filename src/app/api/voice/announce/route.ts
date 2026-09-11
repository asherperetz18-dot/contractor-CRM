import { NextRequest, NextResponse } from "next/server";
import { getTwilioEnv, validateTwilioSignature } from "@/lib/twilio-env";
import { companyForAccountSid, getTwilioForCompany } from "@/lib/twilio-company";
import { recordingNoticeSay } from "@/lib/voice-notice";
import { resolveCorrelationId } from "@/lib/observability/context";
import { logInfo } from "@/lib/observability/logger";
import { captureError, setRouteScope } from "@/lib/observability/sentry";

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
  const startedAt = Date.now();
  const correlationId = resolveCorrelationId(new URL(req.url).searchParams.get("cid"));
  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) params[key] = String(value);

  const companyId = await companyForAccountSid(params.AccountSid || "");
  setRouteScope({ route: "api/voice/announce", correlationId, companyId: companyId ?? undefined });
  const twilioEnv = companyId ? await getTwilioForCompany(companyId) : getTwilioEnv();

  // No credentials means no signature to verify against. Answering with
  // the notice anyway is the safe failure: the alternative is a call
  // that connects without one, which is the exact situation the notice
  // exists to prevent.
  if (twilioEnv) {
    const signature = req.headers.get("x-twilio-signature");
    if (!validateTwilioSignature(req.url, params, signature, twilioEnv.authToken)) {
      // This is one of the plausible root causes behind a Twilio Voice
      // SDK "General Error" that fires right around the callee
      // answering: this leg's TwiML fetch failing here can abort the
      // bridge the browser is waiting on. See docs/DECISIONS.md.
      captureError(new Error("Twilio signature validation failed"), {
        route: "api/voice/announce",
        correlationId,
        companyId: companyId ?? undefined,
        service: "twilio",
      });
      return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
    }
  }

  logInfo({
    event: "api/voice/announce.completed",
    route: "api/voice/announce",
    correlationId,
    companyId: companyId ?? undefined,
    durationMs: Date.now() - startedAt,
  });

  return new NextResponse(
    `<?xml version="1.0" encoding="UTF-8"?><Response>${recordingNoticeSay()}</Response>`,
    { status: 200, headers: { "Content-Type": "text/xml" } }
  );
}
