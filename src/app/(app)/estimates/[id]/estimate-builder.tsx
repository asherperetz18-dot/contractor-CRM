"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  centsFromInput,
  centsToInput,
  computeEstimateTotals,
  isIssuedEstimate,
  lineTotalCents,
  moneyCents,
  signatureProgress,
  type Estimate,
  type EstimateItem,
  type EstimateSigner,
} from "@/lib/data/types";
import {
  markEstimateSent,
  saveEstimateItems,
  sendEstimateToCustomer,
  updateEstimateDetails,
} from "@/lib/actions/estimates";

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
    unitPrice: centsToInput(item.unit_price_cents),
    taxable: item.taxable,
  };
}

export function EstimateBuilder({
  estimate,
  items,
  signers,
  lead,
}: {
  estimate: Estimate;
  items: EstimateItem[];
  signers: EstimateSigner[];
  lead: BuilderLead | null;
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

  const locked = isIssuedEstimate(estimate.status);
  const sig = signatureProgress(signers);

  // Same computeEstimateTotals the server uses when it saves, so the number
  // on screen and the number stored can't drift apart.
  const parsed = rows.map((r) => ({
    quantity: Number(r.quantity) || 0,
    unit_price_cents: centsFromInput(r.unitPrice),
    taxable: r.taxable,
  }));
  const totals = computeEstimateTotals(parsed, estimate.tax_rate_bp);

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
        }))
      );
      if (res.error) return setError(res.error);

      setSaved(`Saved · ${moneyCents(res.totalCents ?? 0)}`);
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
          This estimate was sent to the customer on{" "}
          {estimate.sent_at ? new Date(estimate.sent_at).toLocaleDateString("en-US") : "—"} and is
          read-only. Create a new version to change it.
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

      <table className="data-table est-items">
        <thead>
          <tr>
            <th>Item</th>
            <th className="right">Qty</th>
            <th>Unit</th>
            <th className="right">Price</th>
            <th className="center">Tax</th>
            <th className="right">Total</th>
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
