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

export type ResolvedEstimateRecipients = {
  to: string[];
  cc: string[];
  bcc: string[];
  invalidTo: string[];
  invalidCc: string[];
  invalidBcc: string[];
};

/**
 * The real To/Cc/Bcc for one estimate send.
 *
 * Each bucket excludes every address already claimed by an earlier one,
 * so the same person can't end up listed twice on the same email. A send
 * needs at least one real To, so when the lead itself has no email on
 * file (extras only), the first Cc -- or failing that, the first Bcc --
 * is promoted into To rather than sending a To-less message.
 */
export function resolveEstimateRecipients(params: {
  leadEmail: string | null;
  secondContactEmail: string | null;
  toRaw: string;
  ccRaw: string;
  bccRaw: string;
}): ResolvedEstimateRecipients {
  const { leadEmail, secondContactEmail, toRaw, ccRaw, bccRaw } = params;

  const to: string[] = leadEmail ? [leadEmail] : [];
  const { emails: extraTo, invalid: invalidTo } = parseExtraRecipients(toRaw, [leadEmail]);
  to.push(...extraTo);

  const cc: string[] =
    secondContactEmail && !to.some((t) => t.toLowerCase() === secondContactEmail.toLowerCase())
      ? [secondContactEmail]
      : [];
  const { emails: extraCc, invalid: invalidCc } = parseExtraRecipients(ccRaw, [
    leadEmail,
    secondContactEmail,
    ...to,
  ]);
  cc.push(...extraCc);

  const { emails: bcc, invalid: invalidBcc } = parseExtraRecipients(bccRaw, [
    leadEmail,
    secondContactEmail,
    ...to,
    ...cc,
  ]);

  if (to.length === 0) {
    if (cc.length > 0) {
      to.push(cc.shift()!);
    } else if (bcc.length > 0) {
      to.push(bcc.shift()!);
    }
  }

  return { to, cc, bcc, invalidTo, invalidCc, invalidBcc };
}
