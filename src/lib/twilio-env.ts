import "server-only";

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
