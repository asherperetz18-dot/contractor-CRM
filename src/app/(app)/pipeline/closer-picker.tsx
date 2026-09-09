"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  getLeadCloserContext,
  setLeadCloser,
  type CloserContext,
} from "@/lib/actions/closer";

/**
 * The closer on a contact: who ran the appointment and wrote the
 * estimate, next to the rep who owns the lead.
 *
 * Saves on change rather than waiting for the card's autosave. Naming a
 * closer is what gives that person access to the contact, so "did it
 * take?" needs answering there and then -- the same reason the
 * dispatcher picker commits on its own.
 *
 * Fetches its own context. It is rendered from beside the dispatcher
 * rather than from the contact form, so the lead's id is all it is
 * given.
 */
export function CloserPicker({
  leadId,
  readOnly,
}: {
  leadId: string;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [ctx, setCtx] = useState<CloserContext | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const context = await getLeadCloserContext(leadId);
      if (cancelled || !context) return;
      setCtx(context);
      setValue(context.closerId ?? "");
    })();
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  // Nothing at all until the answer is known. A box that appears empty
  // and then fills itself reads, for the second it is wrong, as "no
  // closer on this job".
  if (!ctx) return null;

  function commit(next: string) {
    const previous = value;
    setValue(next);
    setError("");
    startTransition(async () => {
      const res = await setLeadCloser(leadId, next || null);
      if (res?.error) {
        // Put the dropdown back to what is actually stored. Leaving the
        // new name sitting there under an error message is how somebody
        // walks away believing a closer was assigned when none was.
        setValue(previous);
        return setError(res.error);
      }
      router.refresh();
    });
  }

  const locked = readOnly || !ctx.canEdit;

  return (
    <div className="field">
      <span className="field-label">Closer</span>
      <select
        value={value}
        disabled={pending || locked}
        onChange={(e) => commit(e.target.value)}
      >
        <option value="">No closer</option>
        {ctx.options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>

      {pending && <p className="est-tax-note">Saving…</p>}
      {!pending && !error && !value && (
        <p className="est-tax-note">
          The second chair on this job. They get access to this contact and can write its
          estimates.
        </p>
      )}
      {!pending && !error && !!value && locked && (
        <p className="est-tax-note">Only the office or the assigned rep can change this.</p>
      )}
      {error && <p className="error-note">{error}</p>}
    </div>
  );
}
