/**
 * The carrier's word on an outbound text, shown under the bubble.
 *
 * Deliberately silent for everything except a definite answer: SMS has
 * no read receipts, and the in-flight states (queued, sent) are not
 * facts about the phone -- showing them would invite reading "sent" as
 * "received". A mark appears only when Twilio confirms delivery or
 * reports failure, and old messages that predate callbacks show
 * nothing rather than pretending to know.
 */

// Twilio error codes worth translating -- the ones that tell the office
// what to actually do differently (call instead, fix the number).
const FAILURE_REASONS: Record<string, string> = {
  "30003": "phone unreachable or switched off",
  "30004": "blocked by this phone",
  "30005": "number doesn't exist",
  "30006": "landline — can't receive texts",
  "30007": "filtered as spam by the carrier",
  "21211": "invalid phone number",
};

export function DeliveryTag({
  direction,
  status,
  errorCode,
}: {
  direction: string;
  status: string | null | undefined;
  errorCode?: string | null;
}) {
  if (direction !== "outbound" || !status) return null;

  if (status === "delivered") {
    return (
      <>
        {" · "}
        <span className="msg-delivery-ok">✓ Delivered</span>
      </>
    );
  }
  if (status === "undelivered" || status === "failed") {
    const reason = errorCode ? FAILURE_REASONS[errorCode] : undefined;
    return (
      <>
        {" · "}
        <span
          className="msg-delivery-bad"
          title={errorCode ? `Twilio error ${errorCode}` : undefined}
        >
          ✗ Not delivered{reason ? ` — ${reason}` : ""}
        </span>
      </>
    );
  }
  return null;
}
