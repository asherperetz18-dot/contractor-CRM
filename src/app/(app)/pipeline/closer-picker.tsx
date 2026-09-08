"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Field } from "@/components/ui/field";
import type { Profile } from "@/lib/data/types";
import { setLeadCloser } from "@/lib/actions/closer";

/**
 * The closer on a contact: who ran the appointment and wrote the
 * estimate, next to the rep who owns the lead.
 *
 * Saves on change rather than waiting for the card's autosave. Naming a
 * closer is what gives that person access to the contact, so "did it
 * take?" needs answering there and then -- the same reason the
 * dispatcher picker commits on its own.
 *
 * The assigned rep is left out of the list: they are already on this
 * contact, and offering them as their own second chair reads as a way to
 * give themselves an extra share.
 */
export function CloserPicker({
  leadId,
  currentCloserId,
  assignedRepId,
  reps,
  readOnly,
}: {
  leadId: string;
  currentCloserId: string | null;
  assignedRepId: string | null;
  reps: Profile[];
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [closerId, setCloserId] = useState(currentCloserId ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const options = reps.filter((r) => r.id !== assignedRepId);

  async function handleChange(next: string) {
    const previous = closerId;
    setCloserId(next);
    setPending(true);
    setError("");
    setSaved(false);

    const result = await setLeadCloser(leadId, next || null);
    setPending(false);

    if (result?.error) {
      // Put the dropdown back to what is actually stored. Leaving the
      // new name sitting there under an error message is how somebody
      // walks away believing a closer was assigned when none was.
      setCloserId(previous);
      setError(result.error);
      return;
    }

    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
    startTransition(() => router.refresh());
  }

  return (
    <Field label="Closer">
      <select
        value={closerId}
        disabled={readOnly || pending}
        onChange={(e) => handleChange(e.target.value)}
      >
        <option value="">No closer</option>
        {options.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name || r.email}
          </option>
        ))}
      </select>
      {pending && <p className="hint-note">Saving…</p>}
      {saved && !pending && <span className="cp-saved">✓ Saved</span>}
      {error && <p className="error-note">{error}</p>}
      {!error && !pending && !closerId && (
        <p className="hint-note">
          The second chair on this job. They get access to this contact and can write its
          estimates.
        </p>
      )}
    </Field>
  );
}
