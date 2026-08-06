import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTwilioEnv, validateTwilioSignature } from "@/lib/twilio-env";

function twiml(body: string): NextResponse {
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

// How Twilio's DialCallStatus maps onto what the call actually was, from
// the business's point of view rather than the network's.
const OUTCOME: Record<string, { status: string; disposition: string }> = {
  completed: { status: "completed", disposition: "No Disposition" },
  answered: { status: "completed", disposition: "No Disposition" },
  busy: { status: "missed", disposition: "No Answer" },
  "no-answer": { status: "missed", disposition: "No Answer" },
  failed: { status: "failed", disposition: "No Answer" },
  canceled: { status: "missed", disposition: "No Answer" },
};

/**
 * Runs when the forwarded leg ends. Fills in how long the call actually
 * lasted and whether anyone picked up -- without this every inbound call
 * would sit in Call Reports as "ringing, 0 seconds" forever.
 */
export async function POST(req: NextRequest) {
  const twilioEnv = getTwilioEnv();
  if (!twilioEnv) return twiml("");

  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) params[key] = String(value);

  const signature = req.headers.get("x-twilio-signature");
  if (!validateTwilioSignature(req.url, params, signature, twilioEnv.authToken)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  const callSid = (params.CallSid || "").trim();
  const dialStatus = (params.DialCallStatus || "").trim();
  const duration = Number(params.DialCallDuration || 0) || 0;

  if (callSid) {
    const outcome = OUTCOME[dialStatus] ?? { status: dialStatus || "completed", disposition: "No Disposition" };
    const admin = createAdminClient();
    await admin
      .from("call_logs")
      .update({
        status: outcome.status,
        disposition: outcome.disposition,
        duration_seconds: duration,
      })
      .eq("twilio_call_sid", callSid)
      .eq("direction", "inbound");
  }

  // Nobody picked up: say so rather than dropping the caller into
  // silence, which reads as a broken line.
  if (dialStatus && dialStatus !== "completed" && dialStatus !== "answered") {
    return twiml(
      `<Say voice="alice">Sorry we missed you. Please leave a message or send us a text, and we'll get right back to you.</Say>`
    );
  }
  return twiml("");
}
