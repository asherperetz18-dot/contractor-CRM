/**
 * What the customer portal's chips and buttons say, and in what colour.
 *
 * Colour is meaning here, never decoration (the semantic-chips rule):
 * blue is the state of the paperwork, green is money that came in, amber
 * is something still waiting on the customer, slate is closed.
 */

export type PortalTone = "blue" | "green" | "amber" | "slate";

export type PortalChip = { label: string; tone: PortalTone };

export function estimateStatusChip(status: string): PortalChip {
  if (status === "Signed") return { label: "Signed", tone: "blue" };
  if (status === "Declined") return { label: "Declined", tone: "slate" };
  return { label: "Awaiting your signature", tone: "amber" };
}

/** Money still owed wins: it is the one thing the customer has to act on. */
export function estimateMoneyChip(e: {
  depositPaid: boolean;
  amountDueCents: number;
}): PortalChip | null {
  if (e.amountDueCents > 0) {
    const due = (e.amountDueCents / 100).toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
    });
    return { label: `${due} deposit due`, tone: "amber" };
  }
  if (e.depositPaid) return { label: "Deposit paid", tone: "green" };
  return null;
}

/** An invoice (a permit fee billed back): what's still due, or paid. */
export function invoiceMoneyChip(e: { totalCents: number; paidCents: number }): PortalChip {
  const owed = Math.max(0, e.totalCents - e.paidCents);
  if (owed === 0) return { label: "Paid", tone: "green" };
  const due = (owed / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
  return { label: `${due} due`, tone: "amber" };
}

/** `step` is the zero-based index of the current step. */
export function journeyProgress(step: number, total: number) {
  return {
    label: `Step ${step + 1} of ${total}`,
    percent: Math.round(((step + 1) / total) * 100),
  };
}

// Each network in its own brand colour, so the customer finds the one
// they use without reading. Keys are the labels portal/home/page.tsx builds.
const SOCIAL_CLASS: Record<string, string> = {
  Facebook: "portal-social-facebook",
  Instagram: "portal-social-instagram",
  LinkedIn: "portal-social-linkedin",
  YouTube: "portal-social-youtube",
  TikTok: "portal-social-tiktok",
  Yelp: "portal-social-yelp",
  "Google Reviews": "portal-social-google",
};

export function socialLinkClass(label: string): string {
  const brand = SOCIAL_CLASS[label];
  return brand ? `portal-social-link ${brand}` : "portal-social-link";
}
