import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTwilioEnv, validateTwilioSignature } from "@/lib/twilio-env";
import { companyForInboundNumber, getTwilioForCompany } from "@/lib/twilio-company";
import { toE164 } from "@/lib/data/types";
import { leadForPhoneNumber } from "@/lib/data/lead-for-number";
import { recordingNoticeSay } from "@/lib/voice-notice";

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function twiml(body: string): NextResponse {
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

async function readParams(req: NextRequest): Promise<Record<string, string>> {
  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) params[key] = String(value);
  return params;
}

/**
 * Someone calling the company's Twilio number.
 *
 * Identifies the caller against the contact book, records the call so it
 * shows up in Call Reports the way outbound ones do, then rings whatever
 * number the company set for forwarding.
 *
 * No callerId on the Dial on purpose: for an inbound call Twilio passes
 * the original caller's number through by default, which is what makes
 * the forwarded call useful -- you can see who it is and call them back
 * from your phone's own log.
 */
export async function POST(req: NextRequest) {
  const params = await readParams(req);
  const from = (params.From || "").trim();
  const to = (params.To || "").trim();
  const callSid = (params.CallSid || "").trim();

  // The number that was called identifies the company, and each company
  // signs with its own auth token, so this has to be resolved before the
  // signature can be checked at all.
  const inboundCompanyId = await companyForInboundNumber(to);
  const twilioEnv = inboundCompanyId
    ? await getTwilioForCompany(inboundCompanyId)
    : getTwilioEnv();
  if (!twilioEnv) {
    return twiml(`<Say>This line is not configured.</Say>`);
  }

  const signature = req.headers.get("x-twilio-signature");
  if (!validateTwilioSignature(req.url, params, signature, twilioEnv.authToken)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  const admin = createAdminClient();

  // Resolved from the number dialled. This used to take the first
  // company with any forwarding number configured, because one shared
  // number genuinely could not tell two companies apart -- which meant a
  // call to one business could ring another's phone.
  let companyQuery = admin
    .from("company_profile")
    .select("company_id, call_forward_number, call_forward_timeout");
  companyQuery = inboundCompanyId
    ? companyQuery.eq("company_id", inboundCompanyId)
    : companyQuery.not("call_forward_number", "is", null);

  const { data: companies } = await companyQuery;
  const company =
    ((companies as
      | { company_id: string; call_forward_number: string | null; call_forward_timeout: number }[]
      | null) ?? [])[0] ?? null;

  // Same normalisation as the dialer: someone typing 818-300-8242 into
  // Settings should not silently fail to ring.
  const forwardTo = toE164(company?.call_forward_number);

  // Caller ID matched against the contact book, so the call lands on the
  // right lead in Call Reports rather than as an anonymous number. Shared
  // with the outbound path so both directions file a call the same way --
  // including the 1000-row paging, and the refusal to guess when several
  // leads share one number.
  const leadId =
    company && from
      ? await leadForPhoneNumber(admin, company.company_id, from)
      : null;

  if (company) {
    // Logged before the dial, not after: a caller who hangs up while it
    // rings is exactly the one worth knowing about, and a row written
    // only on completion would miss them.
    await admin.from("call_logs").insert({
      lead_id: leadId,
      rep_id: null,
      direction: "inbound",
      from_number: from,
      to_number: to,
      status: "ringing",
      duration_seconds: 0,
      disposition: "No Disposition",
      twilio_call_sid: callSid || null,
      company_id: company.company_id,
    });
  }

  if (!forwardTo) {
    // There was no <Record> here. The caller was told to leave a message
    // after the tone, then got no tone, no beep and a dead line -- the
    // system promising something it did not do, to the customer, in their
    // own words. Anyone who rang outside hours and waited politely for a
    // beep was talking to nobody.
    //
    // The notice comes first because a voicemail is a recording of them.
    return twiml(
      recordingNoticeSay() +
        `<Say voice="alice">Thanks for calling. Please leave us a message after the tone, or send a text to this number.</Say>` +
        `<Record maxLength="120" playBeep="true" trim="trim-silence"` +
        ` recordingStatusCallback="${xmlEscape(`${new URL(req.url).origin}/api/voice/recording-status`)}"` +
        ` recordingStatusCallbackEvent="completed" />`
    );
  }

  const timeout = company?.call_forward_timeout ?? 25;
  const origin = new URL(req.url).origin;
  const actionUrl = `${origin}/api/voice/inbound/status`;

  // The notice goes before the Dial, which is the right place inbound:
  // the caller is already expecting a greeting, and they are the party
  // whose consent California requires. Outbound has to work harder --
  // there the notice hangs off <Number> so it reaches the homeowner
  // instead of the rep.
  //
  // Recording and the notice are added together on purpose. Inbound was
  // not recorded at all before this, so half of every conversation was
  // missing from the record -- and a customer disputing what was agreed
  // is just as likely to have rung in as been rung.
  return twiml(
    recordingNoticeSay() +
      `<Dial timeout="${timeout}" action="${xmlEscape(actionUrl)}" method="POST"` +
      ` record="record-from-answer-dual"` +
      ` recordingStatusCallback="${xmlEscape(`${origin}/api/voice/recording-status`)}"` +
      ` recordingStatusCallbackEvent="completed">` +
      `<Number>${xmlEscape(forwardTo)}</Number>` +
      `</Dial>`
  );
}
