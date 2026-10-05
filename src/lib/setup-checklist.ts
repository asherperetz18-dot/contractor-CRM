/**
 * The setup checklist (DECISIONS #136): what a new company still has to
 * set up before the CRM works fully for it, each item with a clear done
 * signal read from the company's own settings. Shown to its Office and
 * Admin people on the Dashboard until everything is done, and as a count
 * on Platform Admin › Companies.
 *
 * Pure, so the rules are tested apart from the database.
 */
import { twilioSource } from "./twilio-source.ts";

export type SetupKey = "details" | "logo" | "phone" | "payments" | "contract" | "team";

/** What the checklist reads, one company at a time. */
export type SetupFacts = {
  phone: string | null;
  email: string | null;
  address: string | null;
  logoUrl: string | null;
  /** The company's time zone label ("Pacific", ...), shown so it gets checked. */
  timezone: string | null;
  /** Its own Twilio account, token and number are saved -- what `twilioSource` calls "own". */
  ownTwilio: boolean;
  /** Its own Stripe key is saved, so customers can pay online. */
  ownStripe: boolean;
  /** A default contract template exists, so new estimates carry a contract. */
  defaultContract: boolean;
  /** Active people of its own; platform admins looking in aren't counted. */
  team: number;
};

export type SetupItem = {
  key: SetupKey;
  /** The step, as the company's Admin reads it. */
  title: string;
  /** A short name for the Companies page ("Missing: Logo, Team"). */
  short: string;
  detail: string;
  href: string;
  done: boolean;
};

const filled = (s: string | null | undefined) => !!s && s.trim() !== "";

export function setupItems(f: SetupFacts): SetupItem[] {
  const zone = filled(f.timezone) ? f.timezone : "Pacific";
  return [
    {
      key: "details",
      title: "Add your business phone, email and address",
      short: "Details",
      detail: `They go on your estimates and contracts, and customers' email replies come to this email. While you're there, check the time zone: it's set to ${zone}.`,
      href: "/settings/company-profile",
      done: filled(f.phone) && filled(f.email) && filled(f.address),
    },
    {
      key: "logo",
      title: "Upload your logo",
      short: "Logo",
      detail: "It shows on your estimates, on PDFs and on the customer portal.",
      href: "/settings?card=logo",
      done: filled(f.logoUrl),
    },
    {
      key: "phone",
      title: "Connect your texting and calling number",
      short: "Phone number",
      detail: "Your company texts and calls customers from its own Twilio number. Until it's connected, texting and calling are off.",
      href: "/settings/twilio",
      done: f.ownTwilio,
    },
    {
      key: "payments",
      title: "Take payments online",
      short: "Payments",
      detail: "Connect your own Stripe account so customers can pay you online from the customer portal.",
      href: "/settings/portal-payments",
      done: f.ownStripe,
    },
    {
      key: "contract",
      title: "Add your contract",
      short: "Contract",
      detail: "Paste in the agreement your customers sign. Every new estimate carries it.",
      href: "/settings/contracts",
      done: f.defaultContract,
    },
    {
      key: "team",
      title: "Add your team",
      short: "Team",
      detail: "Add the people who work with you, and pick each one's role.",
      href: "/settings/users-roles",
      done: f.team >= 2,
    },
  ];
}

export type SetupSummary = { done: number; total: number; missing: string[] };

export function setupSummary(items: SetupItem[]): SetupSummary {
  return {
    done: items.filter((i) => i.done).length,
    total: items.length,
    missing: items.filter((i) => !i.done).map((i) => i.short),
  };
}

/** The company_profile columns the checklist reads; the secrets only for whether they're there. */
export const SETUP_PROFILE_COLUMNS =
  "company_id, phone, email, address, logo_url, timezone, twilio_account_sid, twilio_auth_token_enc, twilio_phone_number, stripe_secret_key_enc";

export type SetupProfileRow = {
  company_id: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  logo_url: string | null;
  timezone: string | null;
  twilio_account_sid: string | null;
  twilio_auth_token_enc: string | null;
  twilio_phone_number: string | null;
  stripe_secret_key_enc: string | null;
};

/**
 * One company's facts from its profile row. Only whether each secret is
 * saved leaves here -- never the secret, even encrypted. Own Twilio is
 * `twilioSource`'s own test: account, token and number all saved.
 */
export function setupFactsFromRow(
  row: SetupProfileRow | null | undefined,
  defaultContract: boolean,
  team: number
): SetupFacts {
  return {
    phone: row?.phone ?? null,
    email: row?.email ?? null,
    address: row?.address ?? null,
    logoUrl: row?.logo_url ?? null,
    timezone: row?.timezone ?? null,
    ownTwilio:
      !!row &&
      twilioSource({
        company_id: row.company_id,
        company_name: null,
        twilio_account_sid: row.twilio_account_sid,
        twilio_phone_number: row.twilio_phone_number,
        has_token: !!row.twilio_auth_token_enc,
        has_voice: false,
      }) === "own",
    ownStripe: !!row?.stripe_secret_key_enc,
    defaultContract,
    team,
  };
}

/** The cookie that hides the checklist on one browser, per company. */
export function setupHiddenCookie(companyId: string): string {
  return `crm_setup_hidden_${companyId}`;
}
