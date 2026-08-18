"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { isAdminRole, toE164 } from "@/lib/data/types";
import { getTwilioForCompany } from "@/lib/twilio-company";
import { portalBaseUrl } from "@/lib/portal/session";

export type CompanyPhoneNumber = {
  id: string;
  phone_number: string;
  label: string | null;
  is_default: boolean;
};

/**
 * Every number this company may call from, default first.
 *
 * Readable by any member -- the dialer's "Calling from" list is not a
 * secret -- while writes stay Office/Admin through RLS.
 */
export async function listCompanyPhoneNumbers(): Promise<CompanyPhoneNumber[]> {
  const profile = await getCurrentProfile();
  if (!profile) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("company_phone_numbers")
    .select("id, phone_number, label, is_default")
    .eq("company_id", profile.company_id)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .returns<CompanyPhoneNumber[]>();
  return data ?? [];
}

type TwilioNumberRow = {
  phone_number: string;
  friendly_name: string;
  sid: string;
  voice_url: string;
  sms_url: string;
};

/**
 * Pull the numbers this company's Twilio account owns and register them.
 *
 * Buying happens in the Twilio console; this is the one-click step after.
 * Numbers already registered keep their label and default flag. Newly
 * bought numbers arrive pointing at Twilio's demo message, so their
 * voice and SMS webhooks are set to this app's inbound endpoints --
 * a customer calling back the number they saw must reach the company,
 * not a recording about Twilio. Numbers whose webhooks already point at
 * this app are left exactly as they are.
 */
export async function refreshPhoneNumbersFromTwilio(): Promise<{
  error?: string;
  added?: number;
  total?: number;
  webhooksSet?: number;
}> {
  const profile = await getCurrentProfile();
  if (!profile || !isAdminRole(profile)) return { error: "Office or Admin only." };

  const twilio = await getTwilioForCompany(profile.company_id);
  if (!twilio) return { error: "Twilio is not connected for this company." };

  const basicAuth = Buffer.from(`${twilio.accountSid}:${twilio.authToken}`).toString("base64");
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${twilio.accountSid}/IncomingPhoneNumbers.json?PageSize=100`,
    { headers: { Authorization: `Basic ${basicAuth}` } }
  );
  const json = (await res.json().catch(() => null)) as {
    incoming_phone_numbers?: TwilioNumberRow[];
    message?: string;
  } | null;
  if (!res.ok || !json?.incoming_phone_numbers) {
    return { error: json?.message || "Could not read the account's numbers from Twilio." };
  }

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("company_phone_numbers")
    .select("phone_number, is_default")
    .eq("company_id", profile.company_id)
    .returns<{ phone_number: string; is_default: boolean }[]>();
  const known = new Set((existing ?? []).map((r) => toE164(r.phone_number)));

  const base = portalBaseUrl();
  // Never write a localhost webhook into a live Twilio number: a dev
  // machine refreshing the list must not re-route production callbacks.
  const canConfigureWebhooks = base.startsWith("https://");
  let added = 0;
  let webhooksSet = 0;

  for (const num of json.incoming_phone_numbers) {
    const e164 = toE164(num.phone_number);

    if (!known.has(e164)) {
      // Twilio's FriendlyName defaults to the number itself; only keep
      // it as a label when somebody actually named the number.
      const label =
        num.friendly_name && toE164(num.friendly_name) !== e164 ? num.friendly_name : null;
      const { error } = await supabase
        .from("company_phone_numbers")
        .insert({ company_id: profile.company_id, phone_number: e164, label });
      if (!error) added += 1;
    }

    // Point the number at this app unless it already is. The check is
    // on the path rather than the host, because this app answers on
    // more than one domain (crm. and portal.) -- a number already
    // routed to our inbound endpoints on either is left exactly as it
    // is, and only a number never routed here (for a fresh purchase,
    // Twilio's demo URL) is rewired.
    const voiceOk = (num.voice_url || "").includes("/api/voice/inbound");
    const smsOk = (num.sms_url || "").includes("/api/sms/webhook");
    if (canConfigureWebhooks && (!voiceOk || !smsOk)) {
      const update = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${twilio.accountSid}/IncomingPhoneNumbers/${num.sid}.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${basicAuth}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            VoiceUrl: `${base}/api/voice/inbound`,
            VoiceMethod: "POST",
            SmsUrl: `${base}/api/sms/webhook`,
            SmsMethod: "POST",
          }),
        }
      );
      if (update.ok) webhooksSet += 1;
    }
  }

  // A list where nothing is default would make the dialer's fallback a
  // guess. If the flag is missing entirely it goes to the number the
  // company already calls from today, so registering extras changes
  // nothing until somebody picks one on purpose.
  const { data: after } = await supabase
    .from("company_phone_numbers")
    .select("id, phone_number, is_default")
    .eq("company_id", profile.company_id)
    .order("created_at", { ascending: true })
    .returns<{ id: string; phone_number: string; is_default: boolean }[]>();
  if (after?.length && !after.some((r) => r.is_default)) {
    const current = after.find((r) => r.phone_number === toE164(twilio.phoneNumber));
    await supabase
      .from("company_phone_numbers")
      .update({ is_default: true })
      .eq("id", (current ?? after[0]).id)
      .select("id");
  }

  revalidatePath("/settings/phone-numbers");
  return { added, total: after?.length ?? 0, webhooksSet };
}

export async function setDefaultPhoneNumber(id: string): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile || !isAdminRole(profile)) return { error: "Office or Admin only." };

  const supabase = await createClient();
  const { data: target } = await supabase
    .from("company_phone_numbers")
    .select("id")
    .eq("id", id)
    .eq("company_id", profile.company_id)
    .maybeSingle();
  if (!target) return { error: "Number not found." };

  await supabase
    .from("company_phone_numbers")
    .update({ is_default: false })
    .eq("company_id", profile.company_id)
    .eq("is_default", true)
    .select("id");
  const { data, error } = await supabase
    .from("company_phone_numbers")
    .update({ is_default: true })
    .eq("id", id)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Could not set the default." };

  revalidatePath("/settings/phone-numbers");
  return {};
}

export async function updatePhoneNumberLabel(
  id: string,
  label: string
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile || !isAdminRole(profile)) return { error: "Office or Admin only." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_phone_numbers")
    .update({ label: label.trim() || null })
    .eq("id", id)
    .eq("company_id", profile.company_id)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Could not save the label." };

  revalidatePath("/settings/phone-numbers");
  return {};
}

/**
 * Remove a number from the CRM's list. The number itself stays owned in
 * Twilio -- releasing it is a console decision, not a CRM one.
 */
export async function removePhoneNumber(id: string): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile || !isAdminRole(profile)) return { error: "Office or Admin only." };

  const supabase = await createClient();
  const { data: target } = await supabase
    .from("company_phone_numbers")
    .select("id, is_default")
    .eq("id", id)
    .eq("company_id", profile.company_id)
    .maybeSingle<{ id: string; is_default: boolean }>();
  if (!target) return { error: "Number not found." };
  if (target.is_default) {
    return { error: "This is the default number — make another one default first." };
  }

  const { data, error } = await supabase
    .from("company_phone_numbers")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Could not remove the number." };

  revalidatePath("/settings/phone-numbers");
  return {};
}
