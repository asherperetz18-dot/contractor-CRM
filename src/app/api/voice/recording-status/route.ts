import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTwilioEnv, validateTwilioSignature } from "@/lib/twilio-env";
import { companyForAccountSid, getTwilioForCompany } from "@/lib/twilio-company";
import { requestCallTranscript } from "@/lib/voice-intelligence";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) params[key] = String(value);

  // The recording lives in the account that made it, so that account is
  // both who to verify against and, later, whose credentials can play it
  // back. See the recording route.
  const companyId = await companyForAccountSid(params.AccountSid || "");
  const twilioEnv = companyId ? await getTwilioForCompany(companyId) : getTwilioEnv();
  if (!twilioEnv) {
    return NextResponse.json({ error: "Twilio not configured" }, { status: 500 });
  }

  const signature = req.headers.get("x-twilio-signature");
  if (!validateTwilioSignature(req.url, params, signature, twilioEnv.authToken)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  const callSid = params.CallSid;
  const recordingUrl = params.RecordingUrl;
  if (callSid && recordingUrl) {
    const admin = createAdminClient();
    const { data: logRow } = await admin
      .from("call_logs")
      .update({ recording_url: `${recordingUrl}.mp3` })
      .eq("twilio_call_sid", callSid)
      .select("id, lead_id, company_id")
      .maybeSingle<{ id: string; lead_id: string | null; company_id: string | null }>();

    // The recording is also the raw material for AI call notes. Under
    // ~20 seconds there was no conversation -- a hang-up, a wrong
    // number -- and transcribing it would bill the company for nothing.
    // Any failure here no-ops: the note is a bonus on top of the
    // recording pipeline, never a reason for it to error.
    const duration = Number(params.RecordingDuration || 0);
    if (logRow?.lead_id && logRow.company_id && params.RecordingSid && duration >= 20) {
      try {
        await requestCallTranscript({
          callLogId: logRow.id,
          companyId: logRow.company_id,
          recordingSid: params.RecordingSid,
          webhookUrl: `${new URL(req.url).origin}/api/voice/transcript-ready`,
        });
      } catch {
        // Deliberately swallowed -- see above.
      }
    }
  }

  return new NextResponse("", { status: 200 });
}
