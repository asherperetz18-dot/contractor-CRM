import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePhone, type Lead } from "@/lib/data/types";

function computeTwilioSignature(
  url: string,
  params: Record<string, string>,
  authToken: string
): string {
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) data += key + params[key];
  return crypto.createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

function validateTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string | null,
  authToken: string
): boolean {
  if (!signature) return false;
  const expected = computeTwilioSignature(url, params, authToken);
  const expectedBuf = Buffer.from(expected);
  const signatureBuf = Buffer.from(signature);
  if (expectedBuf.length !== signatureBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, signatureBuf);
}

export async function POST(req: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    return NextResponse.json({ error: "Twilio not configured" }, { status: 500 });
  }

  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) params[key] = String(value);

  const signature = req.headers.get("x-twilio-signature");
  if (!validateTwilioSignature(req.url, params, signature, authToken)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  const from = params.From || "";
  const to = params.To || "";
  const body = params.Body || "";

  const admin = createAdminClient();
  const { data: leads } = await admin
    .from("leads")
    .select("id, phone, second_contact_phone");

  const normalizedFrom = normalizePhone(from);
  const rows = (leads as Pick<Lead, "id" | "phone" | "second_contact_phone">[]) ?? [];
  const matched = rows.find(
    (l) =>
      (l.phone && normalizePhone(l.phone) === normalizedFrom) ||
      (l.second_contact_phone && normalizePhone(l.second_contact_phone) === normalizedFrom)
  );

  await admin.from("sms_messages").insert({
    lead_id: matched?.id ?? null,
    direction: "inbound",
    from_number: from,
    to_number: to,
    body,
    twilio_sid: params.MessageSid || null,
  });

  return new NextResponse("<Response></Response>", {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}
