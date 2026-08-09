"use client";

import { useEffect, useState } from "react";
import { getEventOwners, getDispatcherContext } from "@/lib/actions/dispatcher";

/**
 * Says who holds the lead behind this appointment.
 *
 * A dispatcher can see every appointment but can only edit the ones on
 * their own or unclaimed leads. Without this they meet appointments that
 * silently refuse to save, with nothing on screen explaining why -- and
 * "it didn't work" is how people conclude the app is broken.
 *
 * Only rendered for dispatchers. Office and Admin can edit everything,
 * so for them it would be noise.
 */
export function EventOwnerNote({ eventId }: { eventId: string }) {
  const [state, setState] = useState<{
    show: boolean;
    name: string | null;
    isMine: boolean;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [ctx, owners] = await Promise.all([
        getDispatcherContext(),
        getEventOwners([eventId]),
      ]);
      if (cancelled) return;
      const owner = owners[0];
      setState({
        // Office and Admin can edit anything; this is only for the
        // people the restriction actually applies to.
        show: !!ctx?.isDispatcher && !ctx.canAssignAnyone && !!owner,
        name: owner?.dispatcherName ?? null,
        isMine: owner?.isMine ?? true,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  if (!state?.show) return null;

  if (!state.isMine) {
    return (
      <p className="hint-note">
        This lead is held by <strong>{state.name}</strong>, so this appointment is read-only for
        you. You can see it to keep the schedule straight, but only they can change it.
      </p>
    );
  }

  return (
    <p className="est-tax-note">
      Dispatcher: <strong>{state.name ?? "unassigned — claim it to make it yours"}</strong>
    </p>
  );
}
