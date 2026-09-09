"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setOptionalItemAsCustomer } from "@/lib/actions/portal-estimates";

/**
 * The tick box on an optional line.
 *
 * Interactive only in the portal, where the person clicking is the
 * customer the option is offered to. Everywhere else -- the staff
 * preview, a print -- it renders disabled, showing the current choice:
 * the office ticking it for the customer would defeat the point of
 * offering it.
 *
 * The box flips immediately from local state; the server recomputes the
 * totals and the refresh brings the new numbers onto the page. On an
 * error (expired link, document signed meanwhile) the box flips back
 * and says why.
 */
export function OptionalItemCheckbox({
  estimateId,
  itemId,
  selected,
  interactive,
}: {
  estimateId: string;
  itemId: string;
  selected: boolean;
  interactive: boolean;
}) {
  const router = useRouter();
  const [checked, setChecked] = useState(selected);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="estdoc-optional">
      <label className="estdoc-optional-box">
        <input
          type="checkbox"
          checked={checked}
          disabled={!interactive || pending}
          onChange={(e) => {
            const next = e.target.checked;
            setChecked(next);
            setError(null);
            startTransition(async () => {
              const res = await setOptionalItemAsCustomer(estimateId, itemId, next);
              if (res.error) {
                setChecked(!next);
                return setError(res.error);
              }
              router.refresh();
            });
          }}
        />
        <span className="estdoc-optional-tag">Optional</span>
        <span className="estdoc-muted">
          {pending
            ? "Updating your total…"
            : checked
              ? "— added to your total"
              : interactive
                ? "— tick the box to add this to your project"
                : "— not included"}
        </span>
      </label>
      {error && <div className="estdoc-optional-error">{error}</div>}
    </div>
  );
}
