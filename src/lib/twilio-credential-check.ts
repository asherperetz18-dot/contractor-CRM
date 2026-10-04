/**
 * Settings → Twilio checks what an admin typed with Twilio itself before
 * anything is saved.
 *
 * It used to save whatever was typed. A wrong API Key Secret -- or a key
 * made in a different Twilio account -- saved fine, the page said "In-app
 * calling is configured", and every call then died with "Could not place
 * the call." because Twilio refused the calling pass signed with it. Each
 * part is now asked for with the credentials that will later use it: the
 * account and number with the auth token, the TwiML app with the API key
 * the calling pass is signed with (DECISIONS #106). The key must also be
 * one of this account's own: a main account's key can read its
 * sub-accounts, so it would pass the app check, but a calling pass needs
 * the key from the same account as its Account SID (DECISIONS #107).
 *
 * Pure apart from the injected fetch, so it is tested without Twilio
 * (twilio-credential-check.test.ts).
 */

export type TwilioSetup = {
  accountSid: string;
  authToken: string;
  /** E.164, as it will be saved. */
  phoneNumber: string;
  apiKeySid: string | null;
  apiKeySecret: string | null;
  twimlAppSid: string | null;
  /** What the TwiML app's Voice Request URL should be, shown when it isn't. */
  expectedVoiceUrl: string;
};

type VoiceFields = Pick<TwilioSetup, "apiKeySid" | "apiKeySecret" | "twimlAppSid">;

type FetchLike = (
  url: string,
  init: { headers: Record<string, string> }
) => Promise<{ status: number; ok: boolean; json(): Promise<unknown> }>;

const API = "https://api.twilio.com/2010-04-01";
const VOICE_TWIML_PATH = "/api/voice/twiml";
const UNREACHABLE = "Couldn't reach Twilio to check these details, so nothing was saved. Try again in a minute.";

const basicAuth = (user: string, pass: string) => ({
  Authorization: "Basic " + Buffer.from(`${user}:${pass}`).toString("base64"),
});

/** The three in-app calling boxes: all empty (texting only) or all filled, each in its own shape. */
export function voiceFieldsBlock(v: VoiceFields): string | null {
  const filled = [v.apiKeySid, v.apiKeySecret, v.twimlAppSid].filter(Boolean).length;
  if (filled === 0) return null;
  if (filled < 3) {
    return "Fill in all three in-app calling boxes (API Key SID, API Key Secret and TwiML App SID), or leave all three empty.";
  }
  if (!/^SK[0-9a-f]{32}$/i.test(v.apiKeySid ?? "")) {
    return "That doesn't look like an API Key SID (it starts with SK).";
  }
  if (!/^AP[0-9a-f]{32}$/i.test(v.twimlAppSid ?? "")) {
    return "That doesn't look like a TwiML App SID (it starts with AP).";
  }
  return null;
}

/** Why Twilio wouldn't accept this setup, or null when every part checks out. */
export async function checkTwilioSetup(s: TwilioSetup, fetchImpl: FetchLike = fetch): Promise<string | null> {
  try {
    const account = basicAuth(s.accountSid, s.authToken);
    const acct = await fetchImpl(`${API}/Accounts/${s.accountSid}.json`, { headers: account });
    if (acct.status === 401 || acct.status === 403 || acct.status === 404) {
      return "Twilio didn't accept that Account SID and Auth Token together. Copy both again from the Account Info box on this company's Twilio home page.";
    }
    if (!acct.ok) return UNREACHABLE;

    const nums = await fetchImpl(
      `${API}/Accounts/${s.accountSid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(s.phoneNumber)}`,
      { headers: account }
    );
    if (!nums.ok) return UNREACHABLE;
    const list = (await nums.json()) as { incoming_phone_numbers?: unknown[] };
    if (!list.incoming_phone_numbers?.length) {
      return `${s.phoneNumber} isn't a number in this Twilio account. Check the number, and that the Account SID is the account the number was bought in.`;
    }

    if (!s.apiKeySid || !s.apiKeySecret || !s.twimlAppSid) return null;
    const key = await fetchImpl(`${API}/Accounts/${s.accountSid}/Keys/${s.apiKeySid}.json`, { headers: account });
    if (key.status === 404) {
      return "That API key wasn't created in this Twilio account. In Twilio, pick this company's account in the account menu (top left), create the API key there (API keys & tokens), and copy its SID and Secret.";
    }
    if (!key.ok) return UNREACHABLE;

    const app = await fetchImpl(`${API}/Accounts/${s.accountSid}/Applications/${s.twimlAppSid}.json`, {
      headers: basicAuth(s.apiKeySid, s.apiKeySecret),
    });
    if (app.status === 401 || app.status === 403) {
      return "Twilio didn't accept that API Key SID and Secret. The secret must be the one Twilio showed once, when that key was created in this same Twilio account. If you no longer have it, delete the key in Twilio, create a new one, and copy both values straight away.";
    }
    if (app.status === 404) {
      return "That TwiML App isn't in this Twilio account. Create it (Voice → TwiML apps) in the same account as the number, then copy its SID.";
    }
    if (!app.ok) return UNREACHABLE;
    const body = (await app.json()) as { voice_url?: string | null; voice_method?: string | null };
    return twimlAppBlock(body, s.expectedVoiceUrl);
  } catch {
    return UNREACHABLE;
  }
}

/** The TwiML app must send calls to the CRM's /api/voice/twiml, by POST -- on any of its domains. */
function twimlAppBlock(app: { voice_url?: string | null; voice_method?: string | null }, expected: string): string | null {
  let path = "";
  try {
    path = new URL(app.voice_url ?? "").pathname;
  } catch {
    // Empty or not a URL: reported below.
  }
  if (path !== VOICE_TWIML_PATH) {
    return `That TwiML App's Voice Request URL must be ${expected} (HTTP POST). Change it in Twilio under Voice → TwiML apps, then connect again.`;
  }
  if ((app.voice_method ?? "POST").toUpperCase() !== "POST") {
    return "Set that TwiML App's Voice Request method to HTTP POST in Twilio, then connect again.";
  }
  return null;
}
