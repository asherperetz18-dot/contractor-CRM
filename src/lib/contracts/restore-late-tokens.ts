/**
 * The inverse of lateContractValues, for revising a signed contract.
 *
 * Sending froze the money into the stored terms: "{{contract_total}}"
 * became "$114,000.00" and stopped being a token. A revision copies those
 * terms, and if the figures stayed as literal text the customer could
 * sign a v5 whose line items say one total while the contract wording
 * still says v4's. So the copy turns the late-filled values back into
 * their tokens, and the next send fills them with the revision's own
 * figures.
 *
 * Deliberately only the late fields. Names, addresses and licence numbers
 * do not change between versions of the same job, and a wider rewrite
 * could mangle wording a rep edited by hand.
 *
 * Dependency-free on purpose, same reasoning as signature-evidence.ts:
 * reachable both from the app (Next resolves "@/") and from `node --test`
 * (plain ESM resolution, which understands neither the alias nor an
 * extensionless relative import to a .ts file). The caller computes the
 * filled strings with lateContractValues and hands them in.
 */

/** The tokens fillContractMoney froze at send time, and only those. */
const LATE_TOKENS = [
  // Deposit before total: were the two figures ever equal, replacing the
  // total first would consume the deposit's occurrences too.
  "deposit_amount",
  "contract_total",
  "start_date",
  "completion_date",
] as const;

export function restoreLateTokens(
  body: string,
  values: Partial<Record<string, string | null>>
): string {
  let out = body;
  for (const token of LATE_TOKENS) {
    const filled = values[token];
    if (filled == null || String(filled).trim() === "") continue;
    out = out.split(String(filled)).join(`{{${token}}}`);
  }
  return out;
}
