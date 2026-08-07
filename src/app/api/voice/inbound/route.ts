import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTwilioEnv, validateTwilioSignature } from "@/lib/twilio-env";
import { normalizePhone, toE164 } from "@/lib/data/types";

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
  const twilioEnv = getTwilioEnv();
  if (!twilioEnv) {
    return twiml(`<Say>This line is not configured.</Say>`);
  }

  const params = await readParams(req);
  const signature = req.headers.get("x-twilio-signature");
  if (!validateTwilioSignature(req.url, params, signature, twilioEnv.authToken)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  const from = (params.From || "").trim();
  const to = (params.To || "").trim();
  const callSid = (params.CallSid || "").trim();

  const admin = createAdminClient();

  // One Twilio number serves the account, so the forwarding company is
  // the one that has actually configured a destination. Ambiguity is
  // resolved by taking the first -- with a single number there is no way
  // to tell two companies apart on an inbound call.
  const { data: companies } = await admin
    .from("company_profile")
    .select("company_id, call_forward_number, call_forward_timeout")
    .not("call_forward_number", "is", null);
  const company =
    ((companies as
      | { company_id: string; call_forward_number: string | null; call_forward_timeout: number }[]
      | null) ?? [])[0] ?? null;

  // Same normalisation as the dialer: someone typing 818-300-8242 into
  // Settings should not silently fail to ring.
  const forwardTo = toE164(company?.call_forward_number);

  // Caller ID matched against the contact book, so the call lands on the
  // right lead in Call Reports rather than as an anonymous number.
  let leadId: string | null = null;
  if (company && from) {
    const fromDigits = normalizePhone(from);
    const { data: leads } = await admin
      .from("leads")
      .select("id, phone, second_contact_phone")
      .eq("company_id", company.company_id);
    const rows =
      (leads as { id: string; phone: string | null; second_contact_phone: string | null }[] | null) ??
      [];
    leadId =
      rows.find(
        (l) =>
          (l.phone && normalizePhone(l.phone) === fromDigits) ||
          (l.second_contact_phone && normalizePhone(l.second_contact_phone) === fromDigits)
      )?.id ?? null;
  }

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
    return twiml(
      `<Say voice="alice">Thanks for calling. Please leave us a message after the tone, or send a text to this number.</Say>`
    );
  }

  const timeout = company?.call_forward_timeout ?? 25;
  const actionUrl = `${new URL(req.url).origin}/api/voice/inbound/status`;
  return twiml(
    `<Dial timeout="${timeout}" action="${xmlEscape(actionUrl)}" method="POST">` +
      `<Number>${xmlEscape(forwardTo)}</Number>` +
      `</Dial>`
  );
}
