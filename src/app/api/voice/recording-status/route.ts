import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTwilioEnv, validateTwilioSignature } from "@/lib/twilio-env";

export async function POST(req: NextRequest) {
  const twilioEnv = getTwilioEnv();
  if (!twilioEnv) {
    return NextResponse.json({ error: "Twilio not configured" }, { status: 500 });
  }

  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) params[key] = String(value);

  const signature = req.headers.get("x-twilio-signature");
  if (!validateTwilioSignature(req.url, params, signature, twilioEnv.authToken)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  const callSid = params.CallSid;
  const recordingUrl = params.RecordingUrl;
  if (callSid && recordingUrl) {
    const admin = createAdminClient();
    await admin
      .from("call_logs")
      .update({ recording_url: `${recordingUrl}.mp3` })
      .eq("twilio_call_sid", callSid);
  }

  return new NextResponse("", { status: 200 });
}
