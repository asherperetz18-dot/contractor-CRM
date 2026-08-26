import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTwilioEnv, validateTwilioSignature } from "@/lib/twilio-env";
import { companyForAccountSid, getTwilioForCompany } from "@/lib/twilio-company";

/**
 * Twilio's delivery report for an outbound text.
 *
 * Fired for each state a message passes through (queued, sent,
 * delivered, ...). The row is found by Twilio SID alone -- sends that
 * never logged a row (crew reminders, new-lead alerts) report into the
 * void, which is fine: the callback exists for messages someone will
 * look at later and wonder about.
 */

// Callbacks arrive out of order -- 'sent' can land after 'delivered'
// when the carrier confirms faster than Twilio's own pipeline reports.
// A state may only move forward, so what we know never downgrades.
const RANK: Record<string, number> = {
  queued: 1,
  accepted: 1,
  scheduled: 1,
  sending: 2,
  sent: 3,
  // Terminal states rank equal: a late carrier correction in either
  // direction (delivered -> undelivered or back) is still news.
  delivered: 5,
  undelivered: 5,
  failed: 5,
};

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) params[key] = String(value);

  const sid = params.MessageSid || params.SmsSid || "";
  const status = (params.MessageStatus || params.SmsStatus || "").toLowerCase();
  if (!sid || !status) {
    return NextResponse.json({ error: "Missing message details" }, { status: 400 });
  }

  // A status callback's To is the customer's phone, which identifies no
  // company -- but every Twilio request names the account that sent it,
  // and a company's account is its own. Same trust model as the inbound
  // webhook: claiming an account buys an attacker nothing without that
  // account's auth token to sign with.
  const companyId = await companyForAccountSid(params.AccountSid || "");
  const twilioEnv = companyId ? await getTwilioForCompany(companyId) : getTwilioEnv();
  if (!twilioEnv) {
    return NextResponse.json({ error: "Twilio not configured" }, { status: 500 });
  }

  const signature = req.headers.get("x-twilio-signature");
  if (!validateTwilioSignature(req.url, params, signature, twilioEnv.authToken)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("sms_messages")
    .select("id, delivery_status")
    .eq("twilio_sid", sid)
    .returns<{ id: string; delivery_status: string | null }[]>();

  const newRank = RANK[status] ?? 0;
  for (const row of rows ?? []) {
    const oldRank = RANK[row.delivery_status ?? ""] ?? 0;
    if (newRank < oldRank) continue;
    await admin
      .from("sms_messages")
      .update({
        delivery_status: status,
        // Cleared on success on purpose: a failure code must not outlive
        // a later 'delivered'.
        delivery_error: params.ErrorCode || null,
      })
      .eq("id", row.id);
  }

  return new NextResponse(null, { status: 204 });
}
