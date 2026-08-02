import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePhone, type Lead } from "@/lib/data/types";
import { getTwilioEnv, validateTwilioSignature } from "@/lib/twilio-env";

const YES_WORDS = new Set(["yes", "y", "confirm", "confirmed", "ok", "okay", "yeah", "yep", "sure"]);
const NO_WORDS = new Set(["no", "n", "cancel", "decline", "declined", "nope"]);

type EventRow = {
  id: string;
  lead_id: string | null;
  company_id: string;
};

function escapeXml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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

  const from = params.From || "";
  const to = params.To || "";
  const body = params.Body || "";
  const normalizedFrom = normalizePhone(from);
  const normalizedBody = body.trim().toLowerCase();

  const admin = createAdminClient();
  const [{ data: leads }, { data: profiles }] = await Promise.all([
    admin.from("leads").select("id, company_id, phone, second_contact_phone"),
    admin.from("profiles").select("id, name, phone"),
  ]);

  const leadRows =
    (leads as (Pick<Lead, "id" | "phone" | "second_contact_phone"> & { company_id: string })[]) ?? [];
  const matchedLead = leadRows.find(
    (l) =>
      (l.phone && normalizePhone(l.phone) === normalizedFrom) ||
      (l.second_contact_phone && normalizePhone(l.second_contact_phone) === normalizedFrom)
  );

  const profileRows = (profiles as { id: string; name: string | null; phone: string | null }[]) ?? [];
  const matchedRep = profileRows.find((p) => p.phone && normalizePhone(p.phone) === normalizedFrom);

  const isYesNo = YES_WORDS.has(normalizedBody) || NO_WORDS.has(normalizedBody);
  const confirmed = YES_WORDS.has(normalizedBody);
  const todayISO = new Date().toISOString().slice(0, 10);

  let targetEvent: EventRow | null = null;
  let replyMessage: string | null = null;

  // A rep replying to their "Text Rep Info" message takes priority over a
  // lead match, since a staff member's own phone should never coincide with
  // a lead's, but if it somehow did, treating them as staff is the safer
  // assumption.
  if (isYesNo && matchedRep) {
    const { data: candidateEvents } = await admin
      .from("events")
      .select("id, lead_id, company_id")
      .or(`assigned_to.eq.${matchedRep.id},second_assigned_to.eq.${matchedRep.id}`)
      .in("status", ["New", "Confirmed"])
      .gte("date", todayISO)
      .order("date", { ascending: true })
      .order("time", { ascending: true })
      .limit(1);
    targetEvent = (candidateEvents as EventRow[] | null)?.[0] ?? null;

    if (targetEvent) {
      await admin.from("events").update({ rep_confirmed: confirmed }).eq("id", targetEvent.id);
      if (targetEvent.lead_id) {
        await admin.from("lead_notes").insert({
          lead_id: targetEvent.lead_id,
          author_id: null,
          body: `${confirmed ? "✅" : "❌"} ${matchedRep.name || "Rep"} ${
            confirmed ? "confirmed" : "declined"
          } via text reply.`,
          event_id: targetEvent.id,
          company_id: targetEvent.company_id,
        });
      }
      replyMessage = confirmed
        ? "Got it, marked as confirmed. Thanks!"
        : "Got it, marked as declined. We'll follow up.";
    }
  } else if (isYesNo && matchedLead) {
    const { data: candidateEvents } = await admin
      .from("events")
      .select("id, lead_id, company_id")
      .eq("lead_id", matchedLead.id)
      .in("status", ["New", "Confirmed"])
      .gte("date", todayISO)
      .order("date", { ascending: true })
      .order("time", { ascending: true })
      .limit(1);
    targetEvent = (candidateEvents as EventRow[] | null)?.[0] ?? null;

    if (targetEvent) {
      await admin.from("events").update({ customer_confirmed: confirmed }).eq("id", targetEvent.id);
      await admin.from("lead_notes").insert({
        lead_id: matchedLead.id,
        author_id: null,
        body: `${confirmed ? "✅" : "❌"} Client ${confirmed ? "confirmed" : "declined"} via text reply.`,
        event_id: targetEvent.id,
        company_id: targetEvent.company_id,
      });
      replyMessage = confirmed
        ? "Thanks for confirming! See you then."
        : "Thanks for letting us know — we'll be in touch to reschedule.";
    }
  }

  const companyId = matchedLead?.company_id ?? targetEvent?.company_id ?? null;
  if (companyId) {
    await admin.from("sms_messages").insert({
      lead_id: matchedLead?.id ?? null,
      direction: "inbound",
      from_number: from,
      to_number: to,
      body,
      twilio_sid: params.MessageSid || null,
      company_id: companyId,
    });
  }

  const twiml = replyMessage
    ? `<Response><Message>${escapeXml(replyMessage)}</Message></Response>`
    : "<Response></Response>";

  return new NextResponse(twiml, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}
