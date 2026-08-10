import { NextRequest, NextResponse } from "next/server";
import { getTwilioEnv, validateTwilioSignature } from "@/lib/twilio-env";
import { companyForAccountSid, getTwilioForCompany } from "@/lib/twilio-company";
import { toE164 } from "@/lib/data/types";

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * What the browser dialer's outbound call should do.
 *
 * The company comes from the Twilio account the request was made on: each
 * company's TwiML app lives in its own account, so the account is the
 * company. That matters twice over here -- it decides which token the
 * signature is checked against, and it decides the caller ID. While this
 * read the platform credentials, a second company's rep dialling a
 * homeowner showed the first company's number, and the call back went to
 * a business the customer had never spoken to.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) params[key] = String(value);

  // No match means the platform account, which is what the original
  // business still runs on -- falling through to it keeps that dialer
  // working rather than answering 500 to every call.
  const companyId = await companyForAccountSid(params.AccountSid || "");
  const twilioEnv = companyId ? await getTwilioForCompany(companyId) : getTwilioEnv();
  if (!twilioEnv) {
    return NextResponse.json({ error: "Twilio not configured" }, { status: 500 });
  }

  const signature = req.headers.get("x-twilio-signature");
  if (!validateTwilioSignature(req.url, params, signature, twilioEnv.authToken)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  // Normalised before validating. Contacts are stored however they were
  // typed or imported -- "+1 714-403-5570", "714-403-5570" and
  // "1714-403-5570" are one person -- and the old check rejected anything
  // containing a bracket, dash or space. Those calls ended after two
  // seconds on "Invalid destination number", so only bare ten-digit
  // numbers ever connected.
  const to = toE164(params.To);
  const shouldRecord = params.Record === "true";

  if (!/^\+[0-9]{7,15}$/.test(to)) {
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
