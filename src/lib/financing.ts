/**
 * Customer financing, step 1 (DECISIONS #161). A company pastes in the
 * application link from its own lender's dashboard (Wisetack, Hearth,
 * GreenSky or another), and its customers see "Apply for financing" on
 * their estimates and contracts. The application, the
 * decision and the terms are the lender's: the CRM states no rate and no
 * monthly payment, which only the lender can, with its own disclosures.
 */

export type CompanyFinancing = { provider: string; url: string };

const MAX_URL = 500;
const MAX_PROVIDER = 60;

/** Why this link can't be a lender's public application page, or null. */
function linkError(raw: string): string | null {
  if (!/^https:\/\//i.test(raw)) return "The link must start with https://.";
  if (raw.length > MAX_URL) return "That link is too long.";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "That doesn't look like a link. Copy it from your lender's dashboard.";
  }
  // A public page has a real host name and no sign-in in the address.
  if (!url.hostname.includes(".") || url.username || url.password) {
    return "That doesn't look like a lender's public link. Copy it from your lender's dashboard.";
  }
  return null;
}

/** What's wrong with what the office typed; null when it can be saved.
 *  Both empty switches financing off. */
export function financingSettingsError(input: { provider: string; url: string }): string | null {
  const provider = input.provider.trim();
  const url = input.url.trim();
  if (!provider && !url) return null;
  if (!url) return "Paste the application link your lender gave you.";
  if (!provider) return "Say which lender it is: customers see the name.";
  if (provider.length > MAX_PROVIDER) return "The lender's name is too long.";
  return linkError(url);
}

/** The company's financing as saved, or null when it has none (or the
 *  database is from before 0214). */
export function readFinancing(
  row: { financing_provider?: string | null; financing_url?: string | null } | null
): CompanyFinancing | null {
  const provider = row?.financing_provider?.trim() ?? "";
  const url = row?.financing_url?.trim() ?? "";
  if (!provider || !url || provider.length > MAX_PROVIDER || linkError(url)) return null;
  return { provider, url };
}

/**
 * Whether a document gets the offer: an estimate, contract or change
 * order still open, or signed with money left to pay. Never one that's
 * declined, cancelled or expired, one paid for, an invoice (a permit fee
 * billed back) or a completion certificate.
 */
export function showFinancingOffer(doc: {
  /** The document's kind (contract, change_order, completion, invoice). */
  kind: string | null;
  status: string;
  expired: boolean;
  /** Signed, and every payment on it made. */
  settled: boolean;
}): boolean {
  const kind = doc.kind ?? "contract";
  if (kind !== "contract" && kind !== "change_order") return false;
  if (doc.status === "Declined" || doc.status === "Void" || doc.status === "Draft") return false;
  if (doc.status === "Signed") return !doc.settled;
  return !doc.expired;
}
