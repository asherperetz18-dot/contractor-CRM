import { NextRequest, NextResponse } from "next/server";
import { getTwilioEnv, validateTwilioSignature } from "@/lib/twilio-env";

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

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

  const to = (params.To || "").trim();
  const shouldRecord = params.Record === "true";

  if (!/^\+?[0-9]{7,15}$/.test(to)) {
    return new NextResponse(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Invalid destination number.</Say></Response>`,
      { status: 200, headers: { "Content-Type": "text/xml" } }
    );
  }

  let recordAttrs = "";
  if (shouldRecord) {
    const callbackUrl = `${new URL(req.url).origin}/api/voice/recording-status`;
    recordAttrs =
      ` record="record-from-answer-dual" recordingStatusCallback="${xmlEscape(callbackUrl)}"` +
      ` recordingStatusCallbackEvent="completed"`;
  }
  const twiml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response><Dial callerId="${xmlEscape(twilioEnv.phoneNumber)}"${recordAttrs}>` +
    `<Number>${xmlEscape(to)}</Number>` +
    `</Dial></Response>`;

  return new NextResponse(twiml, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}
