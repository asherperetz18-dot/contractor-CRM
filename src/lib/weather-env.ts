import "server-only";

// Same BOM issue documented in twilio-env.ts affects any secret piped into
// `vercel env add` on this machine -- strip defensively rather than trust
// the CLI/environment.
function stripBom(value: string): string {
  const trimmed = value.trim();
  return trimmed.charCodeAt(0) === 0xfeff ? trimmed.slice(1) : trimmed;
}

/**
 * The US National Weather Service asks for a descriptive User-Agent
 * identifying the app and a contact method, in place of an API key --
 * this is the only "credential" it requires, and it's platform-wide
 * rather than per-company since weather data isn't a customer-facing
 * "sent from your business" credential the way Twilio/Stripe/Resend are.
 */
export function getWeatherUserAgent(): string | null {
  const raw = process.env.WEATHER_USER_AGENT;
  return raw ? stripBom(raw) : null;
}
