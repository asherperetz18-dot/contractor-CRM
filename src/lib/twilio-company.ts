import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/crypto/secrets";
import { getTwilioEnv } from "@/lib/twilio-env";
import type { CompanyTwilioRow, SharedTwilio } from "@/lib/twilio-source";
import { recordingCredentialChoice } from "@/lib/recording-range";

export type CompanyTwilio = {
  accountSid: string;
  authToken: string;
  phoneNumber: string;
};

export type CompanyTwilioVoice = {
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  twimlAppSid: string;
  phoneNumber: string;
};

type TwilioColumns = {
  twilio_account_sid: string | null;
  twilio_auth_token_enc: string | null;
  twilio_phone_number: string | null;
  twilio_api_key_sid: string | null;
  twilio_api_key_secret_enc: string | null;
  twilio_twiml_app_sid: string | null;
};

const COLUMNS =
  "twilio_account_sid, twilio_auth_token_enc, twilio_phone_number, twilio_api_key_sid, twilio_api_key_secret_enc, twilio_twiml_app_sid";

async function loadColumns(companyId: string): Promise<TwilioColumns | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("company_profile")
    .select(COLUMNS)
    .eq("company_id", companyId)
    .maybeSingle<TwilioColumns>();
  return data ?? null;
}

/**
 * The Twilio account a company sends from.
 *
 * A text has to come from the business the customer is talking to. While
 * this was one environment variable, every company's messages went out
 * on one number -- Ca Pro Builder texting a homeowner appeared to come
 * from La Home Contractor, and the reply landed in a shared inbox.
 *
 * A company that hasn't connected its own account gets null -- it does
 * not text or call -- rather than the deployment's TWILIO_* account,
 * which is one business's and used to be lent to every company without
 * one (DECISIONS #104). All three parts must be present together: a
 * company with a number but no token cannot send.
 */
export async function getTwilioForCompany(companyId: string): Promise<CompanyTwilio | null> {
  const row = await loadColumns(companyId);
  const authToken = decryptSecret(row?.twilio_auth_token_enc);

  if (row?.twilio_account_sid && authToken && row.twilio_phone_number) {
    return {
      accountSid: row.twilio_account_sid,
      authToken,
      phoneNumber: row.twilio_phone_number,
    };
  }
  return null;
}

/** Voice needs an API key pair and a TwiML app on top of the account. */
export async function getTwilioVoiceForCompany(
  companyId: string
): Promise<CompanyTwilioVoice | null> {
  const row = await loadColumns(companyId);
  const apiKeySecret = decryptSecret(row?.twilio_api_key_secret_enc);

  if (
    row?.twilio_account_sid &&
    row.twilio_api_key_sid &&
    apiKeySecret &&
    row.twilio_twiml_app_sid &&
    row.twilio_phone_number
  ) {
    return {
      accountSid: row.twilio_account_sid,
      apiKeySid: row.twilio_api_key_sid,
      apiKeySecret,
      twimlAppSid: row.twilio_twiml_app_sid,
      phoneNumber: row.twilio_phone_number,
    };
  }
  return null;
}

/**
 * Which company owns an inbound message, decided by the number it was
 * sent TO.
 *
 * This replaces matching the sender against every company's leads, which
 * only worked while there was one number: two companies holding the same
 * homeowner's phone number would race, and the reply could attach to the
 * wrong business entirely. The receiving number is unambiguous -- a
 * unique index enforces that no two companies claim one.
 */
export async function companyForInboundNumber(toNumber: string): Promise<string | null> {
  const digits = toNumber.replace(/\D/g, "").slice(-10);
  if (digits.length !== 10) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from("company_profile")
    .select("company_id, twilio_phone_number")
    .not("twilio_phone_number", "is", null)
    .returns<{ company_id: string; twilio_phone_number: string }[]>();

  const match = (data ?? []).find(
    (c) => c.twilio_phone_number.replace(/\D/g, "").slice(-10) === digits
  );
  if (match) return match.company_id;

  // Not the main number -- maybe one of the extra numbers a company
  // registered for the dialer (0095). A customer calling back the
  // number they saw must reach that company, not the platform fallback.
  const { data: extra } = await admin
    .from("company_phone_numbers")
    .select("company_id, phone_number")
    .returns<{ company_id: string; phone_number: string }[]>();
  const extraMatch = (extra ?? []).find(
    (c) => c.phone_number.replace(/\D/g, "").slice(-10) === digits
  );
  return extraMatch?.company_id ?? null;
}

/**
 * Which company a Twilio callback belongs to, from the account that sent
 * it.
 *
 * Voice callbacks have no reliable number to match on -- a recording
 * callback carries a call SID and little else, and on a dial-status
 * callback the number that matters depends on the direction. Every Twilio
 * request carries AccountSid, and a company's account is its own, so this
 * answers it directly for all of them.
 *
 * Null means no company has connected that account. Callers then have
 * no credentials to verify the request with, and answer without acting
 * on it (DECISIONS #104).
 */
export async function companyForAccountSid(accountSid: string): Promise<string | null> {
  const sid = accountSid.trim();
  if (!sid) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from("company_profile")
    .select("company_id")
    .eq("twilio_account_sid", sid)
    .maybeSingle<{ company_id: string }>();
  return data?.company_id ?? null;
}

/**
 * The server's shared Twilio account, by its identifiers only -- never
 * the token. Null when the deployment has none configured.
 */
export function sharedTwilio(): SharedTwilio | null {
  const env = getTwilioEnv();
  return env ? { accountSid: env.accountSid, phoneNumber: env.phoneNumber } : null;
}

/**
 * The shared account's credentials for one purpose only: playing back a
 * recording a company made on it while it borrowed that account, before
 * every company had its own (DECISIONS #104, #112). Only a recording
 * listed at the switch in legacy_shared_recordings (0191) -- a table no
 * CRM user can read or write -- and only one on the shared account
 * itself. Never for texting, calling or anything new.
 */
export async function legacySharedRecordingCreds(
  callLogId: string,
  recordingUrl: string
): Promise<{ accountSid: string; authToken: string } | null> {
  const env = getTwilioEnv();
  if (!env) return null;
  if (recordingCredentialChoice(recordingUrl, null, env, true) !== "shared") return null;
  const { data } = await createAdminClient()
    .from("legacy_shared_recordings")
    .select("call_log_id")
    .eq("call_log_id", callLogId)
    .eq("recording_url", recordingUrl)
    .maybeSingle();
  if (!data) return null;
  return { accountSid: env.accountSid, authToken: env.authToken };
}

/**
 * Every company's Twilio identifiers, for deciding who sends from what
 * (lib/twilio-source.ts). Secrets are reduced to "is one stored" before
 * they leave this function.
 */
export async function loadAllCompanyTwilio(): Promise<CompanyTwilioRow[]> {
  const admin = createAdminClient();
  const [{ data: companies }, { data: profiles }] = await Promise.all([
    admin.from("companies").select("id, name"),
    admin
      .from("company_profile")
      .select(
        "company_id, twilio_account_sid, twilio_auth_token_enc, twilio_phone_number, twilio_api_key_sid, twilio_api_key_secret_enc, twilio_twiml_app_sid"
      ),
  ]);
  const byCompany = new Map(
    ((profiles ?? []) as (TwilioColumns & { company_id: string })[]).map((p) => [p.company_id, p])
  );
  return ((companies ?? []) as { id: string; name: string | null }[]).map((c) => {
    const p = byCompany.get(c.id);
    return {
      company_id: c.id,
      company_name: c.name,
      twilio_account_sid: p?.twilio_account_sid ?? null,
      twilio_phone_number: p?.twilio_phone_number ?? null,
      has_token: !!p?.twilio_auth_token_enc,
      has_voice: !!(p?.twilio_api_key_sid && p.twilio_api_key_secret_enc && p.twilio_twiml_app_sid),
    };
  });
}
