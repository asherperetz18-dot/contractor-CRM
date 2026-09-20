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
export function approvalHoldsSend(input: {
  /** company_profile.require_estimate_approval */
  approvalRequired: boolean;
  /** estimates.approved_at -- null until an admin approves. */
  approvedAt: string | null;
}): boolean {
  return input.approvalRequired && !input.approvedAt;
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
