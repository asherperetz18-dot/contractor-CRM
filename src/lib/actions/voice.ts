"use server";

import crypto from "crypto";
import { createClient } from "@/lib/supabase/server";
import { getTwilioVoiceForCompany, type CompanyTwilioVoice } from "@/lib/twilio-company";
import { getCurrentProfile } from "@/lib/data/profile";

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Twilio Access Token: a JWT signed with an API Key Secret, granting the
// holder permission to place/receive calls through the given TwiML App.
// Hand-rolled (HMAC-SHA256) to avoid pulling in the full `twilio` server
// SDK just for token signing -- same approach used for SMS elsewhere.
function buildAccessToken(
  identity: string,
  env: CompanyTwilioVoice
): string {
  const now = Math.floor(Date.now() / 1000);
  const ttl = 3600;

  const header = { typ: "JWT", alg: "HS256", cty: "twilio-fpa;v=1" };
  const payload = {
    jti: `${env.apiKeySid}-${now}`,
    iss: env.apiKeySid,
    sub: env.accountSid,
    iat: now,
    exp: now + ttl,
    grants: {
      identity,
      voice: {
        outgoing: { application_sid: env.twimlAppSid },
        incoming: { allow: false },
      },
    },
  };

  const headerPart = base64url(JSON.stringify(header));
  const payloadPart = base64url(JSON.stringify(payload));
  const signature = crypto
    .createHmac("sha256", env.apiKeySecret)
    .update(`${headerPart}.${payloadPart}`)
    .digest();

  return `${headerPart}.${payloadPart}.${base64url(signature)}`;
}

export async function getVoiceAccessToken(): Promise<{ token?: string; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  // The dialer calls out on this company's own number, so the customer
  // sees the business they are actually dealing with.
  const env = await getTwilioVoiceForCompany(profile.company_id);
  if (!env) return { error: "Calling isn't configured for this company yet." };

  const token = buildAccessToken(user.id, env);
  return { token };
}
