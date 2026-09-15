export type ParsedRecipients = { emails: string[]; invalid: string[] };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Free-typed extra recipients for an estimate send, on top of the lead's
 * own email and its second-contact email.
 *
 * A malformed entry lands in `invalid` rather than being silently dropped
 * -- a rep who fat-fingers an address should be told, not left assuming it
 * went out.
 */
export function parseExtraRecipients(
  raw: string,
  exclude: (string | null | undefined)[]
): ParsedRecipients {
  const excludeSet = new Set(
    exclude.filter((e): e is string => !!e).map((e) => e.trim().toLowerCase())
  );

  const emails: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  for (const piece of raw.split(/[,;\n]/)) {
    const entry = piece.trim();
    if (!entry) continue;
    if (!EMAIL_RE.test(entry)) {
      invalid.push(entry);
      continue;
    }
    const key = entry.toLowerCase();
    if (seen.has(key) || excludeSet.has(key)) continue;
    seen.add(key);
    emails.push(entry);
  }

  return { emails, invalid };
}
