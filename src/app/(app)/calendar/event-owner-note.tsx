"use client";

/**
 * Says who holds the lead behind this appointment.
 *
 * A dispatcher can see every appointment but can only edit the ones on
 * their own or unclaimed leads. Without this they meet appointments that
 * refuse to save with nothing on screen explaining why.
 *
 * Purely props-driven. It used to fetch the holder and its own context
 * after mounting, so the note appeared a beat after the form and pushed
 * everything below it down -- and the form already receives the holder
 * map and the viewer's scoping for the read-only lock, so the fetch was
 * paying for facts already in hand.
 *
 * Only rendered for scoped dispatchers. Office and Admin can edit
 * everything, so for them it would be noise.
 */
export function EventOwnerNote({
  show,
  holderName,
  isMine,
}: {
  /** viewer is a scoped dispatcher -- the only audience this concerns. */
  show: boolean;
  /** Name of the dispatcher holding the lead, null when unclaimed. */
  holderName: string | null;
  isMine: boolean;
}) {
  if (!show) return null;

  if (holderName && !isMine) {
    return (
      <p className="hint-note">
        This lead is held by <strong>{holderName}</strong>, so this appointment is read-only for
        you. You can see it to keep the schedule straight, but only they can change it.
      </p>
    );
  }

  return (
    <p className="est-tax-note">
      Dispatcher: <strong>{isMine && holderName ? holderName : "unassigned — claim it to make it yours"}</strong>
    </p>
  );
}
