import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
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

  if (!/^\+[0-9]{7,15}$/.test(to)) {
    return new NextResponse(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Invalid destination number.</Say></Response>`,
      { status: 200, headers: { "Content-Type": "text/xml" } }
    );
  }

  // The rep may pick which of the company's numbers to show. The pick
  // is only honoured when it is a number the company has registered --
  // the dialer sends whatever the browser held, and a caller ID must
  // never be an arbitrary string a client chose (Truth in Caller ID
  // Act; Twilio would reject it anyway). Anything unrecognised falls
  // back to the company default, so a stale pick degrades rather than
  // fails.
  let callerId = twilioEnv.phoneNumber;
  const requested = params.CallerId ? toE164(params.CallerId) : "";
  if (requested && requested !== toE164(callerId)) {
    const admin = createAdminClient();
    let q = admin
      .from("company_phone_numbers")
      .select("phone_number")
      .eq("phone_number", requested);
    // The platform account serves companies without their own Twilio;
    // when the account doesn't name one company, the number itself must
    // still be registered to somebody on this account's books.
    if (companyId) q = q.eq("company_id", companyId);
    const { data: owned } = await q.maybeSingle();
    if (owned) callerId = requested;
  }

  const origin = new URL(req.url).origin;

  // Recording defaults on: absent means record. A dropped parameter
  // should fail towards the call being captured and announced, not
  // towards a silent one.
  const shouldRecord = params.Record !== "false";

  // Recording and the notice are one decision, never two. California
  // requires the consent of every party to record a confidential
  // communication, so recording without the notice is unlawful -- and
  // announcing without recording tells the customer something untrue.
  // The toggle moves both or neither.
  //
  // The notice rides on <Number> rather than sitting before <Dial>,
  // because TwiML on the <Number> runs on the called leg. Before the
  // <Dial> it would announce the recording to the rep, who already
  // knows, and leave the homeowner -- the only person whose consent is
  // at issue -- hearing nothing. answerOnBridge keeps the rep on
  // ringback until it finishes.
  const recordAttrs = shouldRecord
    ? ` answerOnBridge="true" record="record-from-answer-dual"` +
      ` recordingStatusCallback="${xmlEscape(`${origin}/api/voice/recording-status`)}"` +
      ` recordingStatusCallbackEvent="completed"`
    : "";
  const numberAttrs = shouldRecord
    ? ` url="${xmlEscape(`${origin}/api/voice/announce`)}"`
    : "";

  const twiml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response><Dial callerId="${xmlEscape(callerId)}"${recordAttrs}>` +
    `<Number${numberAttrs}>${xmlEscape(to)}</Number>` +
    `</Dial></Response>`;

  return new NextResponse(twiml, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}
