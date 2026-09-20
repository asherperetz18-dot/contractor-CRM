/**
 * Where a document stands on its way to the customer, in one phrase.
 *
 * The Estimate Status page answers a rep's actual question -- "who is
 * my estimate waiting on?" -- so the gates are evaluated in the order
 * they fire on a real send: the admin approval gate (0136) first, then
 * the closer's hold (decision #024), then the customer.
 *
 * Colors are meanings, not decoration, and reuse the ones the funnel
 * already taught the office to read: amber = awaiting the customer's
 * signature, green = signed (the money arriving). Indigo marks the
 * approval paperwork gate; blue marks progress that is the team's to
 * make next.
 */
export type FlowStatusKey =
  | "awaiting_approval"
  | "closer_sends"
  | "ready_to_send"
  | "awaiting_customer"
  | "signed";

export type FlowStatus = { key: FlowStatusKey; label: string; color: string };

const GREEN_SIGNED = "#2F855A";
const AMBER_AWAITING = "#C7691B";
const INDIGO_PAPERWORK = "#5A67D8";
const BLUE_PROGRESS = "#2B6CB0";

export function estimateFlowStatus(input: {
  /** estimates.status -- Draft, Sent, Viewed or Signed. */
  status: string;
  approvedAt: string | null;
  /** company_profile.require_estimate_approval. */
  approvalRequired: boolean;
  /** leads.closer_id -- null when the lead has no closer. */
  closerId: string | null;
  closerName?: string | null;
  viewerId: string;
}): FlowStatus {
  if (input.status === "Signed") {
    return { key: "signed", label: "Signed", color: GREEN_SIGNED };
  }
  if (input.status === "Sent" || input.status === "Viewed") {
    return {
      key: "awaiting_customer",
      label:
        input.status === "Viewed"
          ? "Viewed — waiting on the customer"
          : "Sent — waiting on the customer",
      color: AMBER_AWAITING,
    };
  }

  // From here the document is a draft, and the question is which gate
  // speaks next.
  if (input.approvalRequired && !input.approvedAt) {
    return {
      key: "awaiting_approval",
      label: "Waiting for admin approval",
      color: INDIGO_PAPERWORK,
    };
  }
  if (input.closerId && input.closerId !== input.viewerId) {
    const who = input.closerName || "the closer";
    return {
      key: "closer_sends",
      label: `Ready — ${who} reviews & sends`,
      color: BLUE_PROGRESS,
    };
  }
  return {
    key: "ready_to_send",
    label:
      input.closerId && input.closerId === input.viewerId
        ? "Ready for you to send"
        : "Draft — ready to send",
    color: BLUE_PROGRESS,
  };
}
