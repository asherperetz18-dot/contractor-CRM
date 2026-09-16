/**
 * Who may put a closer-led lead's document in front of the customer.
 *
 * A lead can carry a closer (leads.closer_id): the second chair who runs
 * the appointment and answers for the price. On those leads the reps
 * still build and save the estimate -- writing it is their job -- but
 * the send is the closer's review: nothing leaves Draft until the closer
 * has read it and pressed Send themselves.
 *
 * This is a hold on top of the existing permissions, never a widening:
 *
 *   - The per-user Estimates switches in Users & Roles keep their say.
 *     A closer still needs Create + Send Estimates to send; a rep with
 *     Send switched off stays drafts-only everywhere, closer or not.
 *   - Office and Admin are never held. The owner must not be locked out
 *     of their own sales -- the same rule canSendEstimates already has.
 *
 * Enforced in the server actions rather than a database trigger, unlike
 * the approval gate (0136): the actual send updates status through the
 * service-role client, where auth.uid() is null and a trigger cannot
 * tell a rep from the closer. Every path out of Draft -- email/text,
 * Mark Sent, signed on paper -- already runs through the same guards in
 * src/lib/actions/estimates.ts, and this hold sits inside them.
 */
export function closerHoldsSend(input: {
  /** leads.closer_id -- null when the lead has no closer. */
  closerId: string | null | undefined;
  userId: string;
  /** Office or Admin (isAdminRole) -- they always send. */
  officeOrAdmin: boolean;
  /** estimates.kind. Completion certificates close out a job already
   *  sold and signed; the closer's review happened before that sale. */
  kind?: string | null;
}): boolean {
  if (!input.closerId) return false;
  if (input.officeOrAdmin) return false;
  if (input.kind === "completion") return false;
  return input.closerId !== input.userId;
}

/** What the held rep reads -- says what to do, not what rule fired. */
export function closerHoldMessage(closerName: string | null): string {
  const who = closerName ? `${closerName}, this lead's closer,` : "This lead's closer";
  return (
    `You can build and save this document, and preview or print it, but ` +
    `${who} reviews it and sends it to the customer. ` +
    `Save your draft and let them know it's ready — or ask an Office or Admin user to send it.`
  );
}
