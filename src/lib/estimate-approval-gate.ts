/**
 * The approval gate (0136), as a rule the app can ask before it acts.
 *
 * With `require_estimate_approval` switched on, a document may not leave
 * Draft until an admin has approved it. The database trigger enforces
 * that on the status change itself -- which is the right backstop, but
 * the wrong moment to find out: by the time the send action flips the
 * status, the email or text is already with the customer. A refused
 * status change after that leaves a document that was sent but reads
 * as never sent, and a customer holding a link the portal turns away.
 *
 * So the same rule is asked here, in the server action, before anything
 * goes out -- the closer's hold (estimate-closer-gate) works the same
 * way, and for the same reason. The trigger stays; this stops the click
 * reaching it.
 */
export type ApprovalOnSend =
  /** Nothing to check: approval is off, or someone already approved it. */
  | "clear"
  /** Refused until an admin approves. */
  | "hold"
  /** The sender holds "Send without approval": the send records the
   *  approval in their name, so the document still says who let it go. */
  | "self-approve";

export function approvalOnSend(input: {
  /** company_profile.require_estimate_approval */
  approvalRequired: boolean;
  /** estimates.approved_at -- null until someone approves. */
  approvedAt: string | null;
  /** company_members.can_send_without_approval, for whoever pressed Send. */
  sendsWithoutApproval: boolean;
}): ApprovalOnSend {
  if (!input.approvalRequired || input.approvedAt) return "clear";
  return input.sendsWithoutApproval ? "self-approve" : "hold";
}

/** The contact-timeline line for a send that approved itself -- "who
 *  said this could go out" is asked months later, usually when
 *  something went wrong, same as an admin's approval note. */
export function selfApprovalNote(docNumber: string | null, senderName: string | null): string {
  return (
    `${docNumber ?? "Document"} sent without waiting for an admin's approval by ` +
    `${senderName || "a teammate"}, who is allowed to send without approval.`
  );
}

/** What the held person reads -- says what to do, not what rule fired.
 *  An admin can approve it themselves -- and meets this text beside an
 *  Approve button (ApproveEstimateButton), so "here" is literal; everyone
 *  else asks one. */
export function approvalHoldMessage(
  docNumber: string | null,
  viewer: { canApprove: boolean }
): string {
  const doc = docNumber || "it";
  const next = viewer.canApprove
    ? `Approve ${doc} here or on the Estimate Approvals screen, then send it.`
    : `Ask an admin to approve ${doc} on the Estimate Approvals screen.`;
  return `This document needs to be approved before it can go out. ${next}`;
}
