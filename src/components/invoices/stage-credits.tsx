"use client";

import { moneyCents, removableCredit, type BillCreditRow } from "@/lib/data/types";
import { RemoveCredit } from "./remove-credit";

const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/**
 * The credits on one contract stage (DECISIONS #154): each with its
 * reason, a removed one struck through with why (#160), and Remove on
 * the ones given by hand for the people who can.
 */
export function StageCredits({ credits, canRemove }: { credits: BillCreditRow[]; canRemove: boolean }) {
  if (!credits.length) return null;
  return (
    <ul className="stage-credits">
      {credits.map((c) => (
        <li key={c.id} className={c.removed_at ? "stage-credit is-removed" : "stage-credit"}>
          <span>
            <span className="mono stage-credit-amount">-{moneyCents(c.amount_cents)}</span> credit,{" "}
            {fmtDay(c.created_at)}: {c.reason}
            {c.refund_payment_id && !c.removed_at && <span className="stage-credit-note"> · came with a refund</span>}
            {c.removed_at && (
              <span className="stage-credit-note">
                {" "}
                · removed {fmtDay(c.removed_at)}
                {c.remove_reason ? `: ${c.remove_reason}` : ""}
              </span>
            )}
          </span>
          {canRemove && removableCredit(c) && <RemoveCredit creditId={c.id} amountCents={c.amount_cents} />}
        </li>
      ))}
    </ul>
  );
}
