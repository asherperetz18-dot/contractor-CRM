/**
 * Which Twilio account each company texts and calls from, and when the
 * server's shared account may be moved into a company's own settings.
 *
 * The shared account is the TWILIO_* deployment settings -- La Home
 * Contractor's, from when the CRM served one business. It used to be lent
 * to every company without its own, so their customers saw La Home's
 * number; it no longer is (DECISIONS #104). Moving it into La Home's own
 * company_profile row (adoptSharedTwilio) makes La Home a company like
 * any other (DECISIONS #103).
 *
 * Pure, so the rules are tested on their own (twilio-source.test.ts).
 */

export type CompanyTwilioRow = {
  company_id: string;
  company_name: string | null;
  twilio_account_sid: string | null;
  twilio_phone_number: string | null;
  /** An encrypted auth token is stored -- never the token itself. */
  has_token: boolean;
  /** API key, secret and TwiML app are all stored: in-app calling works. */
  has_voice: boolean;
};

export type SharedTwilio = { accountSid: string; phoneNumber: string };

/** "own": texts and calls from its own account. "none": cannot until it connects one. */
export type TwilioSource = "own" | "none";

export function twilioSource(row: CompanyTwilioRow): TwilioSource {
  return row.twilio_account_sid && row.has_token && row.twilio_phone_number ? "own" : "none";
}

const digits = (n: string | null) => (n ?? "").replace(/\D/g, "").slice(-10);

/** Why the shared account can't be moved into this company, or null when it can. */
export function adoptSharedBlock(
  companyId: string,
  rows: CompanyTwilioRow[],
  shared: SharedTwilio | null
): string | null {
  if (!shared) return "There's no shared Twilio account configured on this server, so there's nothing to move.";
  const self = rows.find((r) => r.company_id === companyId);
  if (self && twilioSource(self) === "own") {
    return self.twilio_account_sid === shared.accountSid
      ? "The shared Twilio account is already this company's own."
      : "This company already has its own Twilio account. Disconnect it first if the shared one should replace it.";
  }
  const holder = rows.find(
    (r) =>
      r.company_id !== companyId &&
      (r.twilio_account_sid === shared.accountSid ||
        (!!r.twilio_phone_number && digits(r.twilio_phone_number) === digits(shared.phoneNumber)))
  );
  if (holder) {
    return `${holder.company_name || "Another company"} already has the shared Twilio account or its number saved. Disconnect it there first.`;
  }
  return null;
}

export type CompanyTwilioView = {
  companyId: string;
  companyName: string;
  source: TwilioSource;
  /** The number its customers see texts and calls from, or null if none. */
  sendsFrom: string | null;
  voice: boolean;
  /** Other companies saved with the same Twilio account -- callbacks can't tell them apart. */
  sharesAccountWith: string[];
};

const ORDER: Record<TwilioSource, number> = { none: 0, own: 1 };

/** One line per company for the Platform Admin page, the ones needing attention first. */
export function twilioOverview(rows: CompanyTwilioRow[]): CompanyTwilioView[] {
  return rows
    .map((r) => {
      const source = twilioSource(r);
      return {
        companyId: r.company_id,
        companyName: r.company_name || "Unnamed company",
        source,
        sendsFrom: source === "own" ? r.twilio_phone_number : null,
        voice: source === "own" && r.has_voice,
        sharesAccountWith: r.twilio_account_sid
          ? rows
              .filter((o) => o.company_id !== r.company_id && o.twilio_account_sid === r.twilio_account_sid)
              .map((o) => o.company_name || "Unnamed company")
          : [],
      };
    })
    .sort((a, b) => ORDER[a.source] - ORDER[b.source] || a.companyName.localeCompare(b.companyName));
}
