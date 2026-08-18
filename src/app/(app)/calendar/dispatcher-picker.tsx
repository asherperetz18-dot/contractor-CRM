"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  getDispatchers,
  getDispatcherContext,
  setLeadDispatcher,
  type DispatcherOption,
  type DispatcherContext,
} from "@/lib/actions/dispatcher";

/**
 * Who owns this lead as dispatcher.
 *
 * Stored on the lead rather than the appointment even though it is set
 * here: a dispatcher holds a lead from arrival until it sells, and one
 * lead with three appointments must not end up with three people each
 * believing they are owed the commission.
 */
/** Everything the picker needs to render on the first frame. */
export type DispatcherPickerBootstrap = {
  options: DispatcherOption[];
  context: DispatcherContext;
};

export function DispatcherPicker({
  leadId,
  currentDispatcherId,
  readOnly,
  bootstrap,
}: {
  leadId: string;
  currentDispatcherId: string | null;
  readOnly?: boolean;
  /** Handed down from the page where possible. Without it the picker
   *  fetches for itself and arrives on screen a couple of seconds after
   *  the rest of the form -- the fourth control to grow that habit. */
  bootstrap?: DispatcherPickerBootstrap;
}) {
  const router = useRouter();
  const [options, setOptions] = useState<DispatcherOption[] | null>(
    bootstrap?.options ?? null
  );
  const [ctx, setCtx] = useState<DispatcherContext | null>(bootstrap?.context ?? null);
  const [value, setValue] = useState(currentDispatcherId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (bootstrap) return;
    let cancelled = false;
    (async () => {
      const [list, context] = await Promise.all([getDispatchers(), getDispatcherContext()]);
      if (cancelled) return;
      setOptions(list);
      setCtx(context);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (options === null || !ctx) return null;
  const { selfId, canAssignAnyone } = ctx;
  // Nobody holds the Dispatch role yet, so a picker would be an empty
  // box with no way to fill it.
  if (options.length === 0 && !currentDispatcherId) return null;

  function commit(next: string) {
    const previous = value;
    setValue(next);
    setError(null);
    startTransition(async () => {
      const res = await setLeadDispatcher(leadId, next || null);
      if (res.error) {
        setValue(previous);
        return setError(res.error);
      }
      router.refresh();
    });
  }

  const mine = currentDispatcherId === selfId;
  const heldBySomeoneElse = !!currentDispatcherId && !mine;
  const holderName =
    options.find((o) => o.id === currentDispatcherId)?.name ?? "another dispatcher";

  return (
    <div className="field">
      <span className="field-label">Dispatcher</span>

      {canAssignAnyone ? (
        <select value={value} onChange={(e) => commit(e.target.value)} disabled={pending || readOnly}>
          <option value="">Unassigned</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      ) : heldBySomeoneElse ? (
        // A dispatcher cannot take a colleague's lead -- the commission
        // rides on it, so it is shown as taken rather than offered.
        <div className="est-tax-note">Held by {holderName}</div>
      ) : mine ? (
        <div className="dispatch-claim">
          <span className="est-badge est-badge-signed">Yours</span>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => commit("")}
            disabled={pending || readOnly}
          >
            Release
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="btn-primary"
          onClick={() => commit(selfId)}
          disabled={pending || readOnly}
        >
          {pending ? "Claiming…" : "Claim this lead"}
        </button>
      )}

      {error && <p className="error-note">{error}</p>}
    </div>
  );
}
