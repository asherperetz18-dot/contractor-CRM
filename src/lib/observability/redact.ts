/**
 * The one place raw data is allowed to touch anything observability-shaped.
 * Every helper here is allowlist-based, not denylist-based: it names what
 * may pass through rather than trying to guess everything that shouldn't.
 * Nothing goes into a Sentry event or a log line except through one of
 * these -- see docs/DECISIONS.md for why (a Supabase cookie or a Twilio
 * auth token in a log line is a real incident, not a style nit).
 */

const FORBIDDEN_KEY_PATTERN = /token|secret|password|authorization|cookie/i;

/** Keeps just enough of a phone number to recognise, never the whole thing. */
export function maskPhone(value: string | null | undefined): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (trimmed.length <= 6) return "•".repeat(trimmed.length);
  const head = trimmed.slice(0, 2);
  const tail = trimmed.slice(-4);
  return `${head}${"•".repeat(trimmed.length - head.length - tail.length)}${tail}`;
}

/** Copies only the named keys that actually exist on `source`. */
export function pickSafeFields<T extends Record<string, unknown>>(
  source: T,
  allowlist: readonly (keyof T)[]
): Partial<T> {
  const out: Partial<T> = {};
  for (const key of allowlist) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

/**
 * Last line of defense: drops any key that merely looks secret-shaped, and
 * any key left `undefined` (an object built from optional fields should
 * report only what it actually has).
 */
export function scrubForbiddenKeys<T extends Record<string, unknown>>(obj: T): T {
  const out = {} as T;
  for (const [key, value] of Object.entries(obj)) {
    if (FORBIDDEN_KEY_PATTERN.test(key) || value === undefined) continue;
    out[key as keyof T] = value as T[keyof T];
  }
  return out;
}

export type SafeUser = { userId: string; companyId: string; role?: string };

/** Never the rep's name or email -- an id is enough to look a call up by. */
export function safeUser(
  input: { id?: string | null; company_id?: string | null; role?: string | null } | null | undefined
): SafeUser | undefined {
  if (!input?.id || !input?.company_id) return undefined;
  const out: SafeUser = { userId: input.id, companyId: input.company_id };
  if (input.role) out.role = input.role;
  return out;
}

export type SafeTwilioError = {
  code?: number;
  message?: string;
  causes?: string[];
  solutions?: string[];
};

type TwilioLikeError = {
  code?: number;
  message?: string;
  causes?: unknown;
  solutions?: unknown;
  twilioError?: {
    code?: number;
    message?: string;
    causes?: unknown;
    solutions?: unknown;
  };
};

/**
 * Twilio's own error carries the useful diagnostics for a generic code
 * like 31000 -- `causes`/`solutions` on the nested `twilioError`, when the
 * SDK attaches one -- everything else on the object (including any secret
 * that ended up on it) stays behind.
 */
export function safeTwilioError(err: unknown): SafeTwilioError {
  const e = (err ?? {}) as TwilioLikeError;
  const inner = e.twilioError ?? e;
  return scrubForbiddenKeys({
    code: inner.code,
    message: inner.message,
    causes: Array.isArray(inner.causes) ? inner.causes.slice(0, 10) : undefined,
    solutions: Array.isArray(inner.solutions) ? inner.solutions.slice(0, 10) : undefined,
  });
}
