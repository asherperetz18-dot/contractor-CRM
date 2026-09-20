"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  getLeadPartnerContext,
  setLeadPartner,
  type PartnerContext,
} from "@/lib/actions/partner-rep";

/**
 * The partner rep on a contact: the second salesperson who shares the
 * sale with the owner. Both hold the lead, both get sale credit at half
 * value on the Salespeople grid, and at signature they split the rep
 * share of the commission.
 *
 * Same self-loading, save-on-change shape as the closer picker it sits
 * beside -- naming a partner grants access and moves money, so "did it
 * take?" needs answering there and then.
 *
 * When the latest appointment carries a second chair who holds no seat
 * here yet, that name is offered as a one-line suggestion. One click
 * confirms it; nothing is ever set from the calendar alone.
 */
export function PartnerRepPicker({
  leadId,
  readOnly,
}: {
  leadId: string;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [ctx, setCtx] = useState<PartnerContext | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const context = await getLeadPartnerContext(leadId);
      if (cancelled || !context) return;
      setCtx(context);
      setValue(context.partnerId ?? "");
    })();
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  // Nothing at all until the answer is known. A box that appears empty
  // and then fills itself reads, for the second it is wrong, as "no
  // partner on this job".
  if (!ctx) return null;

  function commit(next: string) {
    const previous = value;
    setValue(next);
    setError("");
    startTransition(async () => {
      const res = await setLeadPartner(leadId, next || null);
      if (res?.error) {
        // Put the dropdown back to what is actually stored. Leaving the
        // new name sitting there under an error message is how somebody
        // walks away believing a partnership was set when none was.
        setValue(previous);
        return setError(res.error);
      }
      router.refresh();
    });
  }

  const locked = readOnly || !ctx.canEdit;

  return (
    <div className="field">
      <span className="field-label">Partner Rep</span>
      <select
        value={value}
        disabled={pending || locked}
        onChange={(e) => commit(e.target.value)}
      >
        <option value="">No partner — solo sale</option>
        {ctx.options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>

      {pending && <p className="est-tax-note">Saving…</p>}
      {!pending && !error && !value && ctx.suggestion && !locked && (
        <p className="est-tax-note">
          {ctx.suggestion.name} sat second chair on the appointment.{" "}
          <button
            type="button"
            className="btn-ghost small"
            onClick={() => commit(ctx.suggestion!.id)}
          >
            Set as partner
          </button>
        </p>
      )}
      {!pending && !error && !value && !ctx.suggestion && (
        <p className="est-tax-note">
          Second salesperson on this sale. Both share the credit — the value splits half and
          half — and at signature they split the rep commission.
        </p>
      )}
      {!pending && !error && !!value && locked && (
        <p className="est-tax-note">Only the office or the assigned rep can change this.</p>
      )}
      {error && <p className="error-note">{error}</p>}
    </div>
  );
}
