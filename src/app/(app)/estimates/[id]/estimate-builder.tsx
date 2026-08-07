"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  centsFromInput,
  centsToInput,
  computeEstimateTotals,
  estimateMargin,
  formatMarginPct,
  editWillRecallEstimate,
  estimateLocked,
  lineCostCents,
  lineTotalCents,
  marginPct,
  moneyCents,
  signatureProgress,
  type Estimate,
  type EstimateItem,
  type EstimateSigner,
  type EstimatePayment,
} from "@/lib/data/types";
import {
  markEstimateSent,
  saveEstimateItems,
  sendEstimateToCustomer,
  updateEstimateDetails,
} from "@/lib/actions/estimates";
import { PaymentSchedule } from "./payment-schedule";

export type BuilderLead = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
};

// Quantity and price are held as the raw strings the rep typed so a
// half-finished "12." does not get normalised out from under the cursor.
type Row = {
  key: string;
  name: string;
  description: string;
  quantity: string;
  unit: string;
  unitCost: string;
  unitPrice: string;
  taxable: boolean;
};

let rowSeq = 0;
function blankRow(): Row {
  rowSeq += 1;
  return {
    key: `row-${rowSeq}`,
    name: "",
    description: "",
    quantity: "1",
    unit: "",
    unitCost: "",
    unitPrice: "0.00",
    taxable: false,
  };
}

function toRow(item: EstimateItem): Row {
  rowSeq += 1;
  return {
    key: `row-${rowSeq}`,
    name: item.name,
    description: item.description ?? "",
    quantity: String(item.quantity),
    unit: item.unit ?? "",
    // Blank, not "0.00" -- an unknown cost and a genuinely free item are
    // different, and showing 100% margin on the former would be a lie.
    unitCost: item.cost_cents === null ? "" : centsToInput(item.cost_cents),
    unitPrice: centsToInput(item.unit_price_cents),
    taxable: item.taxable,
  };
}

export function EstimateBuilder({
  estimate,
  items,
  signers,
  payments,
  lead,
  canEdit,
}: {
  estimate: Estimate;
  items: EstimateItem[];
  signers: EstimateSigner[];
  payments: EstimatePayment[];
  lead: BuilderLead | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(items.length ? items.map(toRow) : [blankRow()]);
  const [title, setTitle] = useState(estimate.title);
  const [message, setMessage] = useState(estimate.customer_message ?? "");
  const [terms, setTerms] = useState(estimate.terms ?? "");
  const [expiresAt, setExpiresAt] = useState(estimate.expires_at ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Read-only once the customer has signed, or for a person without
  // write permission. Merely having been sent does not lock it -- the
  // customer asking for a change after reading the quote is the normal
  // course of a sale.
  const signed = estimateLocked(estimate.status, signers);
  const locked = signed || !canEdit;
  // Editing something the customer is currently holding a link to pulls
  // it back to draft, so the rep is told before they start typing rather
  // than after they save.
  const willRecall = !locked && editWillRecallEstimate(estimate.status);
  const sig = signatureProgress(signers);

  // Same computeEstimateTotals the server uses when it saves, so the number
  // on screen and the number stored can't drift apart.
  const parsed = rows.map((r) => ({
    quantity: Number(r.quantity) || 0,
    unit_price_cents: centsFromInput(r.unitPrice),
    taxable: r.taxable,
    // Blank means unknown, which is not the same as zero.
    cost_cents: r.unitCost.trim() === "" ? null : centsFromInput(r.unitCost),
  }));
  const totals = computeEstimateTotals(parsed, estimate.tax_rate_bp);
  const margin = estimateMargin(parsed);
  const costsEntered = parsed.some((p) => p.cost_cents !== null);

  function patch(key: string, changes: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...changes } : r)));
    setSaved(null);
  }

  function save(then?: () => void) {
    setError(null);
    startTransition(async () => {
      const detail = await updateEstimateDetails(estimate.id, {
        title,
        customer_message: message || null,
        terms: terms || null,
        expires_at: expiresAt || null,
      });
      if (detail.error) return setError(detail.error);

      const res = await saveEstimateItems(
        estimate.id,
        rows.map((r) => ({
          name: r.name,
          description: r.description || null,
          quantity: Number(r.quantity) || 0,
          unit: r.unit || null,
          unit_price_cents: centsFromInput(r.unitPrice),
          taxable: r.taxable,
          cost_cents: r.unitCost.trim() === "" ? null : centsFromInput(r.unitCost),
        }))
      );
      if (res.error) return setError(res.error);

      setSaved(
        res.recalled
          ? `Saved · ${moneyCents(res.totalCents ?? 0)} · recalled from the customer, send again when ready`
          : `Saved · ${moneyCents(res.totalCents ?? 0)}`
      );
      router.refresh();
      then?.();
    });
  }

  // Texting the portal link is the normal path; marking it sent without
  // texting is the fallback for a customer with no mobile number, or one
  // the rep is handing a printout to in person.
  function send(deliver: "text" | "manual") {
    setError(null);
    startTransition(async () => {
      const res =
        deliver === "text"
          ? await sendEstimateToCustomer(estimate.id)
          : await markEstimateSent(estimate.id);
      if (res.error) return setError(res.error);
      setSaved(
        deliver === "text" && "sentTo" in res && res.sentTo
          ? `Texted to ${res.sentTo}`
          : "Marked as sent"
      );
      router.refresh();
    });
  }

  const customer = lead
    ? [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim() || "Unnamed lead"
    : "Unknown customer";

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">
            {estimate.doc_number}
            {estimate.version > 1 && <span className="est-version"> v{estimate.version}</span>}
          </h1>
          <p className="module-sub">
            {customer}
            {lead?.address ? ` · ${lead.address}` : ""}
          </p>
        </div>
        <div className="est-header-actions">
          <button className="btn-ghost" onClick={() => router.push("/estimates")}>
            Back
          </button>
          <button
            className="btn-ghost"
            onClick={() => router.push(`/estimates/${estimate.id}/preview`)}
          >
            Preview as Customer
          </button>
          {/* Routes to the document and fires the dialog there: printing
              this page would print the editor's input boxes. */}
          <button
            className="btn-ghost"
            onClick={() => router.push(`/estimates/${estimate.id}/preview?print=1`)}
          >
            Print / PDF
          </button>
          {!locked && (
            <>
              <button className="btn-ghost" onClick={() => save()} disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </button>
              <button
                className="btn-ghost"
                onClick={() => save(() => send("manual"))}
                disabled={pending}
                title="Mark as sent without texting -- for a customer with no mobile number"
              >
                Mark Sent
              </button>
              <button
                className="btn-primary"
                onClick={() => save(() => send("text"))}
                disabled={pending}
              >
                Save &amp; Text to Customer
              </button>
            </>
          )}
        </div>
      </div>

      {locked && (
        <div className="est-locked-banner">
          {!canEdit ? (
            "You can view estimates but not change them. Ask an Office or Admin user for Create Estimates access."
          ) : (
            <>
              The customer signed this on{" "}
              {estimate.signed_at
                ? new Date(estimate.signed_at).toLocaleDateString("en-US")
                : "—"}
              , so it is now a contract and cannot be edited. Create a new version to change it.
            </>
          )}
          {sig.total > 0 && (
            <>
              {" "}
              Signatures: {sig.signed} of {sig.total}
              {sig.pending.length > 0 && ` · Pending: ${sig.pending.join(", ")}`}
            </>
          )}
        </div>
      )}

      <div className="est-meta-grid">
        <label className="field">
          <span className="field-label">Title</span>
          <input
            className="est-title-input"
            value={title}
            disabled={locked}
            onChange={(e) => {
              setTitle(e.target.value);
              setSaved(null);
            }}
          />
        </label>
        <label className="field">
          <span className="field-label">Expires</span>
          <input
            className="est-title-input"
            type="date"
            value={expiresAt}
            disabled={locked}
            onChange={(e) => {
              setExpiresAt(e.target.value);
              setSaved(null);
            }}
          />
        </label>
      </div>

      <div className="est-items-wrap">
        <table className="data-table est-items">
        <thead>
          <tr>
            <th>Item</th>
            <th className="right">Qty</th>
            <th>Unit</th>
            <th className="right est-internal-col">Cost</th>
            <th className="right">Price</th>
            <th className="center">Tax</th>
            <th className="right">Total</th>
            <th className="right est-internal-col">Margin</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>
                <input
                  className="est-item-name"
                  placeholder="Description of work"
                  value={r.name}
                  disabled={locked}
                  onChange={(e) => patch(r.key, { name: e.target.value })}
                />
                <input
                  className="est-item-desc"
                  placeholder="Detail (optional, shown to customer)"
                  value={r.description}
                  disabled={locked}
                  onChange={(e) => patch(r.key, { description: e.target.value })}
                />
              </td>
              <td className="right">
                <input
                  className="est-item-qty"
                  inputMode="decimal"
                  value={r.quantity}
                  disabled={locked}
                  onChange={(e) => patch(r.key, { quantity: e.target.value })}
                />
              </td>
              <td>
                <input
                  className="est-item-unit"
                  placeholder="ea"
                  value={r.unit}
                  disabled={locked}
                  onChange={(e) => patch(r.key, { unit: e.target.value })}
                />
              </td>
              <td className="right est-internal-col">
                <input
                  className="est-item-price est-item-cost"
                  inputMode="decimal"
                  placeholder="—"
                  value={r.unitCost}
                  disabled={locked}
                  onChange={(e) => patch(r.key, { unitCost: e.target.value })}
                  aria-label="Your cost (internal)"
                />
              </td>
              <td className="right">
                <input
                  className="est-item-price"
                  inputMode="decimal"
                  value={r.unitPrice}
                  disabled={locked}
                  onChange={(e) => patch(r.key, { unitPrice: e.target.value })}
                />
              </td>
              <td className="center">
                <input
                  type="checkbox"
                  checked={r.taxable}
                  disabled={locked}
                  onChange={(e) => patch(r.key, { taxable: e.target.checked })}
                  aria-label="Taxable"
                />
              </td>
              <td className="right mono">
                {moneyCents(lineTotalCents(Number(r.quantity) || 0, centsFromInput(r.unitPrice)))}
              </td>
              <td className="right mono est-internal-col">
                {(() => {
                  if (r.unitCost.trim() === "") return <span className="est-margin-none">—</span>;
                  const qty = Number(r.quantity) || 0;
                  const revenue = lineTotalCents(qty, centsFromInput(r.unitPrice));
                  const cost = lineCostCents(qty, centsFromInput(r.unitCost));
                  const pct = marginPct(revenue, cost);
                  // Selling below cost is the thing this column exists to
                  // catch, so it has to be impossible to skim past.
                  const cls =
                    pct === null ? "" : pct < 0 ? " est-margin-loss" : pct < 20 ? " est-margin-thin" : "";
                  return (
                    <span className={"est-margin" + cls}>
                      {formatMarginPct(pct)}
                      <span className="est-margin-abs">{moneyCents(revenue - cost)}</span>
                    </span>
                  );
                })()}
              </td>
              <td>
                {!locked && rows.length > 1 && (
                  <button
                    className="btn-ghost est-row-remove"
                    onClick={() => {
                      setRows((prev) => prev.filter((x) => x.key !== r.key));
                      setSaved(null);
                    }}
                    aria-label="Remove line"
                  >
                    ×
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>

      {!locked && (
        <button className="btn-ghost est-add-row" onClick={() => setRows((p) => [...p, blankRow()])}>
          + Add line
        </button>
      )}

      <div className="est-totals">
        <div className="est-total-row">
          <span>Subtotal</span>
          <span className="mono">{moneyCents(totals.subtotalCents)}</span>
        </div>
        <div className="est-total-row">
          <span>
            Tax
            {estimate.tax_rate_bp > 0 && (
              <span className="est-tax-rate"> ({(estimate.tax_rate_bp / 100).toFixed(2)}%)</span>
            )}
          </span>
          <span className="mono">{moneyCents(totals.taxCents)}</span>
        </div>
        <div className="est-total-row est-total-grand">
          <span>Total</span>
          <span className="mono">{moneyCents(totals.totalCents)}</span>
        </div>
        {estimate.tax_rate_bp === 0 && (
          <p className="est-tax-note">
            No tax rate set. Add one in Admin Settings to tax the lines marked above.
          </p>
        )}
      </div>

      {costsEntered && (
        <div className="est-margin-panel">
          <div className="est-margin-head">
            Your margin
            <span className="est-internal-flag">Internal only — never shown to the customer</span>
          </div>
          <div className="est-margin-figures">
            <div>
              <span className="est-margin-label">Cost</span>
              <span className="mono">{moneyCents(margin.costCents)}</span>
            </div>
            <div>
              <span className="est-margin-label">Gross profit</span>
              <span className="mono">{moneyCents(margin.profitCents)}</span>
            </div>
            <div>
              <span className="est-margin-label">Margin</span>
              <span
                className={
                  "mono est-margin" +
                  (margin.pct === null
                    ? ""
                    : margin.pct < 0
                      ? " est-margin-loss"
                      : margin.pct < 20
                        ? " est-margin-thin"
                        : "")
                }
              >
                {formatMarginPct(margin.pct)}
              </span>
            </div>
          </div>
          {margin.pct !== null && margin.pct < 0 && (
            <p className="est-margin-warn">
              This job is priced below cost — you would lose {moneyCents(-margin.profitCents)}.
            </p>
          )}
          <p className="est-tax-note">
            Margin is a share of the price, not a markup on cost. Costs left blank are excluded
            rather than counted as zero.
          </p>
        </div>
      )}

      {willRecall && (
        <div className="est-recall-banner">
          <strong>This is out with the customer.</strong> You can still edit it — saving pulls it
          back to draft so they can&apos;t sign a version they never read, and their existing link
          stops working. Send it again when you&apos;re done.
        </div>
      )}

      <PaymentSchedule
        estimateId={estimate.id}
        totalCents={totals.totalCents}
        depositPercentBp={estimate.deposit_percent_bp}
        depositCapCents={estimate.deposit_cap_cents}
        payments={payments}
        locked={locked}
        onChanged={() => router.refresh()}
      />

      <div className="est-meta-grid">
        <label className="field">
          <span className="field-label">Message to customer</span>
          <textarea
            className="est-textarea"
            rows={3}
            value={message}
            disabled={locked}
            onChange={(e) => {
              setMessage(e.target.value);
              setSaved(null);
            }}
          />
        </label>
        <label className="field">
          <span className="field-label">Terms</span>
          <textarea
            className="est-textarea"
            rows={3}
            value={terms}
            disabled={locked}
            onChange={(e) => {
              setTerms(e.target.value);
              setSaved(null);
            }}
          />
        </label>
      </div>

      {error && <p className="error-note">{error}</p>}
      {saved && <p className="hint-note">{saved}</p>}
    </div>
  );
}
