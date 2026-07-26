import "server-only";
import crypto from "crypto";

// Vercel CLI (via `vercel env add`) has proven to intermittently prepend
// a UTF-8 BOM to piped-in values on this machine/Windows setup -- every
// re-add attempt reproduced it regardless of encoding used to pipe the
// value in. A BOM can never legitimately appear in these values, so
// strip one defensively rather than depend on the CLI behaving.
function stripBom(value: string): string {
  const trimmed = value.trim();
  return trimmed.charCodeAt(0) === 0xfeff ? trimmed.slice(1) : trimmed;
}

export function getTwilioEnv() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const phoneNumber = process.env.TWILIO_PHONE_NUMBER;
  if (!accountSid || !authToken || !phoneNumber) return null;
  return {
    accountSid: stripBom(accountSid),
    authToken: stripBom(authToken),
    phoneNumber: stripBom(phoneNumber),
  };
}

export function validateTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string | null,
  authToken: string
): boolean {
  if (!signature) return false;
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) data += key + params[key];

  const expected = crypto.createHmac("sha1", authToken).update(data, "utf8").digest("base64");
  const expectedBuf = Buffer.from(expected);
  const signatureBuf = Buffer.from(signature);
  if (expectedBuf.length !== signatureBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, signatureBuf);
}

export function getTwilioVoiceEnv() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const apiKeySid = process.env.TWILIO_API_KEY_SID;
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;
  const twimlAppSid = process.env.TWILIO_TWIML_APP_SID;
  const phoneNumber = process.env.TWILIO_PHONE_NUMBER;
  if (!accountSid || !apiKeySid || !apiKeySecret || !twimlAppSid || !phoneNumber) return null;
  return {
    accountSid: stripBom(accountSid),
    apiKeySid: stripBom(apiKeySid),
    apiKeySecret: stripBom(apiKeySecret),
    twimlAppSid: stripBom(twimlAppSid),
    phoneNumber: stripBom(phoneNumber),
  };
}
