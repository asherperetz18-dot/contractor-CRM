import "server-only";

/**
 * The admin client, widened at the boundary.
 *
 * Typed as `unknown` and narrowed below on purpose: naming the real
 * builder type makes the compiler expand the generated Database generics
 * through every chained method and give up with "type instantiation is
 * excessively deep". The shape asserted below is the whole contract.
 */
type Client = { from: (table: string) => unknown };

type EventUpdate = {
  update: (values: Record<string, unknown>) => {
    eq: (column: string, value: string) => {
      eq: (column: string, value: string) => PromiseLike<unknown>;
    } & PromiseLike<unknown>;
  };
};

/**
 * Records that the customer confirmed, on both fields that mean it.
 *
 * customer_confirmed is what the "reply YES to confirm" text sets, and
 * status is what the calendar's filter chips read. They were only ever
 * written separately, so 30 appointments were confirmed by the customer
 * while 7 carried the Confirmed status -- filtering the calendar to
 * Confirmed hid three quarters of the confirmed week.
 *
 * The status only moves up from New. An appointment already marked
 * Showed, No-show or Cancelled has been through something a person
 * recorded, and a late YES must not drag it backwards -- a customer
 * replying to yesterday's reminder should not un-cancel their job.
 *
 * A NO is deliberately not the mirror image. It clears
 * customer_confirmed and leaves the status alone: declining means
 * "reschedule me", which is a conversation, not a state the system
 * should decide on its own.
 */
export async function applyCustomerConfirmation(
  admin: Client,
  eventId: string,
  confirmed: boolean
): Promise<void> {
  const events = () => admin.from("events") as EventUpdate;

  await events().update({ customer_confirmed: confirmed }).eq("id", eventId);
  if (!confirmed) return;
  await events()
    .update({ status: "Confirmed" })
    .eq("id", eventId)
    // The guard is in the statement rather than a read-then-write, so a
    // status changed between the two cannot slip through the gap.
    .eq("status", "New");
}
