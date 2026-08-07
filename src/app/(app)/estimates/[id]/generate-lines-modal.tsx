"use client";

import { useState, useTransition } from "react";
import { centsToInput, moneyCents } from "@/lib/data/types";
import { generatePricedLines, type ProposedLine } from "@/lib/actions/scope-ai";

export type AcceptedLine = {
  name: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
};

/**
 * Review step between the AI and the estimate.
 *
 * Nothing generated reaches the document until the rep ticks it here.
 * That is the whole point: these numbers end up on a page a homeowner
 * signs, and "the computer suggested it" is not a defence for a price
 * nobody checked. Every field stays editable in this list, and lines the
 * model could not price are flagged rather than quietly shown as free.
 */
export function GenerateLinesModal({
  onClose,
  onAccept,
}: {
  onClose: () => void;
  onAccept: (lines: AcceptedLine[]) => void;
}) {
  const [brief, setBrief] = useState("");
  const [lines, setLines] = useState<ProposedLine[] | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [pricedFromRateCard, setPricedFromRateCard] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function generate() {
    setError(null);
    startTransition(async () => {
      const res = await generatePricedLines(brief);
      if (res.error) return setError(res.error);
      setLines(res.lines ?? []);
      setPricedFromRateCard(res.priced ?? false);
      // Everything starts ticked -- the rep unticks what they don't want,
      // which is faster than ticking 20 boxes, while still requiring a
      // deliberate Add.
      setChosen(new Set((res.lines ?? []).map((_, i) => i)));
    });
  }

  const selected = lines?.filter((_, i) => chosen.has(i)) ?? [];
  const selectedTotal = selected.reduce((s, l) => s + l.quantity * l.unit_price_cents, 0);
  const unpricedCount = selected.filter((l) => !l.priced).length;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal scope-modal" onClick={(e) => e.stopPropagation()}>
        <div className="scope-modal-head">
          <div>
            <h2 className="est-pay-title">Generate priced estimate</h2>
            <p className="est-pay-sub">
              Paste the scope of work, or describe the job. Nothing is added until you review it
              below.
            </p>
          </div>
        </div>

        {lines === null ? (
          <>
            <textarea
              className="scope-textarea"
              autoFocus
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder={
                "e.g.\n\nFull bathroom remodel, 8x10. Demo existing tub and tile. New 60x32 tub, tile to ceiling, 36in vanity, new exhaust fan vented outside, paint."
              }
            />
            {error && <p className="error-note">{error}</p>}
            <div className="modal-actions">
              <button className="btn-ghost" onClick={onClose} disabled={pending}>
                Cancel
              </button>
              <button className="btn-primary" onClick={generate} disabled={pending || !brief.trim()}>
                {pending ? "Generating…" : "Generate lines"}
              </button>
            </div>
          </>
        ) : (
          <>
            {!pricedFromRateCard && (
              <p className="error-note">
                No rate card is set, so these lines have <strong>no prices</strong> — the generator
                will not guess at market rates. Add your rates in Admin Settings &rarr; AI
                Estimator, or price these yourself after adding them.
              </p>
            )}

            <div className="gen-lines-wrap">
              <table className="data-table gen-lines">
                <thead>
                  <tr>
                    <th></th>
                    <th>Item</th>
                    <th className="right">Qty</th>
                    <th>Unit</th>
                    <th className="right">Price</th>
                    <th className="right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i} className={chosen.has(i) ? "" : "gen-line-off"}>
                      <td>
                        <input
                          type="checkbox"
                          checked={chosen.has(i)}
                          onChange={(e) => {
                            const next = new Set(chosen);
                            if (e.target.checked) next.add(i);
                            else next.delete(i);
                            setChosen(next);
                          }}
                          aria-label={`Include ${l.name}`}
                        />
                      </td>
                      <td>
                        <div className="ur-name">{l.name}</div>
                        {l.description && <div className="ur-add-phone">{l.description}</div>}
                      </td>
                      <td className="right mono">{l.quantity}</td>
                      <td>{l.unit}</td>
                      <td className="right mono">
                        {l.priced ? (
                          moneyCents(l.unit_price_cents)
                        ) : (
                          <span className="gen-unpriced">not priced</span>
                        )}
                      </td>
                      <td className="right mono">
                        {l.priced ? moneyCents(l.quantity * l.unit_price_cents) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="est-pay-balance est-pay-ok">
              <div className="est-pay-verdict">
                {selected.length} of {lines.length} lines selected ·{" "}
                {moneyCents(selectedTotal)}
                {unpricedCount > 0 && (
                  <span className="gen-unpriced">
                    {" "}
                    · {unpricedCount} still need{unpricedCount === 1 ? "s" : ""} a price from you
                  </span>
                )}
              </div>
            </div>

            <p className="est-tax-note">
              These are a draft. Check every line and price before you send — you are the one
              signing this, not the model.
            </p>

            {error && <p className="error-note">{error}</p>}

            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setLines(null)} disabled={pending}>
                Start over
              </button>
              <button className="btn-ghost" onClick={onClose} disabled={pending}>
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={() =>
                  onAccept(
                    selected.map((l) => ({
                      name: l.name,
                      description: l.description,
                      quantity: String(l.quantity),
                      unit: l.unit,
                      unitPrice: centsToInput(l.unit_price_cents),
                    }))
                  )
                }
                disabled={pending || selected.length === 0}
              >
                Add {selected.length} line{selected.length === 1 ? "" : "s"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
