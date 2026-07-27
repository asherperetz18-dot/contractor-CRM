import "server-only";

// Same BOM issue documented in twilio-env.ts affects any secret piped into
// `vercel env add` on this machine -- strip defensively rather than trust
// the CLI/environment.
function stripBom(value: string): string {
  const trimmed = value.trim();
  return trimmed.charCodeAt(0) === 0xfeff ? trimmed.slice(1) : trimmed;
}

export function getCronSecret(): string | null {
  const secret = process.env.CRON_SECRET;
  return secret ? stripBom(secret) : null;
}
