"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getTwilioEnv } from "@/lib/twilio-env";

async function requireCanSendSms(): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { data: profile } = await supabase
    .from("profiles")
    .select("roles")
    .eq("id", user.id)
    .single();
  const roles = (profile as { roles: string[] } | null)?.roles ?? [];
  if (!roles.includes("Office") && !roles.includes("Sales")) {
    return { error: "Only Office or Sales users can send messages." };
  }
  return {};
}

export async function sendSms(
  leadId: string | null,
  toNumber: string,
  body: string
): Promise<{ error?: string }> {
  const guard = await requireCanSendSms();
  if (guard.error) return guard;

  const trimmedBody = body.trim();
  if (!trimmedBody) return { error: "Message cannot be empty." };
  if (!toNumber.trim()) return { error: "No phone number to send to." };

  const twilioEnv = getTwilioEnv();
  if (!twilioEnv) {
    return { error: "Twilio is not configured on the server." };
  }
  const { accountSid, authToken, phoneNumber: fromNumber } = twilioEnv;

  const basicAuth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: toNumber, From: fromNumber, Body: trimmedBody }),
    }
  );

  const json = (await res.json().catch(() => null)) as { sid?: string; message?: string } | null;
  if (!res.ok) {
    return { error: json?.message || "Failed to send message." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("sms_messages").insert({
    lead_id: leadId,
    direction: "outbound",
    from_number: fromNumber,
    to_number: toNumber,
    body: trimmedBody,
    twilio_sid: json?.sid ?? null,
  });
  if (error) return { error: error.message };

  revalidatePath("/reply-inbox");
  return {};
}
