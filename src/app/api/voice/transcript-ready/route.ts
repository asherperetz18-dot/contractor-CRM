import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTwilioEnv, validateTwilioSignature } from "@/lib/twilio-env";
import { getTwilioForCompany } from "@/lib/twilio-company";
import { writeAiCallNote } from "@/lib/ai-call-notes";

/**
 * Voice Intelligence's completion webhook: a transcript we asked for is
 * ready. Twilio signs JSON webhooks over url + raw body (form-encoded
 * ones over url + sorted params); both shapes are accepted because the
 * payload format is Twilio's choice, not ours.
 *
 * The stronger check than the signature is the lookup: the transcript
 * sid must match one this app stored when it requested the transcript.
 * A sid nobody asked for is answered with 200 and ignored -- returning
 * an error would only make Twilio retry it.
 */

function validateJsonSignature(
  url: string,
  rawBody: string,
  signature: string | null,
  authToken: string
): boolean {
  if (!signature) return false;
  const expected = crypto
    .createHmac("sha1", authToken)
    .update(url + rawBody, "utf8")
    .digest("base64");
  const expectedBuf = Buffer.from(expected);
  const signatureBuf = Buffer.from(signature);
  if (expectedBuf.length !== signatureBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, signatureBuf);
}

export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") || "";
  const signature = req.headers.get("x-twilio-signature");

  const params: Record<string, string> = {};
  let rawBody = "";
  if (contentType.includes("application/json")) {
    rawBody = await req.text();
    try {
      const parsed = JSON.parse(rawBody) as Record<string, unknown>;
      for (const [k, v] of Object.entries(parsed)) params[k] = String(v ?? "");
    } catch {
      return new NextResponse("", { status: 200 });
    }
  } else {
    const form = await req.formData();
    for (const [key, value] of form.entries()) params[key] = String(value);
  }

  const transcriptSid = params.transcript_sid || params.TranscriptSid || "";
  const eventType = (params.event_type || params.EventType || "").toLowerCase();
  if (!transcriptSid) return new NextResponse("", { status: 200 });

  const admin = createAdminClient();
  const { data: log } = await admin
    .from("call_logs")
    .select("id, company_id")
    .eq("transcript_sid", transcriptSid)
    .maybeSingle<{ id: string; company_id: string | null }>();
  if (!log?.company_id) return new NextResponse("", { status: 200 });

  const twilioEnv = (await getTwilioForCompany(log.company_id)) ?? getTwilioEnv();
  if (!twilioEnv) return new NextResponse("", { status: 200 });

  const signatureOk = rawBody
    ? validateJsonSignature(req.url, rawBody, signature, twilioEnv.authToken)
    : validateTwilioSignature(req.url, params, signature, twilioEnv.authToken);
  if (!signatureOk) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  // Failed or redacted-only events carry nothing worth writing.
  if (eventType && !eventType.includes("available") && !eventType.includes("completed")) {
    return new NextResponse("", { status: 200 });
  }

  await writeAiCallNote(log.id);
  return new NextResponse("", { status: 200 });
}
