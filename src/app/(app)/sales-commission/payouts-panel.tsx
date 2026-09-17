"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { centsFromInput, moneyCents } from "@/lib/data/types";
import { repDropdownOptions } from "@/lib/data/rep-options";
import {
  recordCommissionPayout,
  removeCommissionPayout,
  type CommissionPayoutRow,
  type CommissionRep,
} from "@/lib/actions/rep-commission";

export type PayoutJobOption = {
  estimateId: string;
  label: string;
  /** The job still has holds on it, so money against it is an advance. */
  held: boolean;
};

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
};

function shortDate(value: string) {
  const d = new Date(`${value}T00:00:00`);
  return isNaN(d.getTime())
    ? value
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * The ledger of money actually handed to reps, and the form that adds
 * to it. Every row deducts from its rep's balance due; an "advance" is
 * the same money recorded before the job settled, kept apart in
 * wording because it explains a statement that says "less advance".
 *
 * Recording and removing are Office/Admin (the action refuses anyone
 * else); a rep sees their own rows read-only.
 */
export function PayoutsPanel({
  payouts,
  reps,
  jobsByRep,
  canRecord,
  everyone,
}: {
  payouts: CommissionPayoutRow[];
  reps: CommissionRep[];
  jobsByRep: Record<string, PayoutJobOption[]>;
  canRecord: boolean;
  everyone: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [repId, setRepId] = useState("");
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(today);
  const [estimateId, setEstimateId] = useState("");
  const [advance, setAdvance] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const jobs = repId ? (jobsByRep[repId] ?? []) : [];

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await recordCommissionPayout({
        repId,
        amountCents: centsFromInput(amount),
        kind: advance ? "advance" : "payout",
        paidOn,
        estimateId: estimateId || null,
        note,
      });
      if (res.error) return setError(res.error);
      setOpen(false);
      setAmount("");
      setEstimateId("");
      setAdvance(false);
      setNote("");
      router.refresh();
    });
  }

  function remove(p: CommissionPayoutRow) {
    const what = p.kind === "advance" ? "advance" : "payment";
    if (
      !window.confirm(
        `Remove this ${moneyCents(p.amountCents)} ${what} to ${p.repName} from the record? ` +
          `Their balance due goes back up by that amount. This can't be undone.`
      )
    )
      return;
    setRowError(null);
    startTransition(async () => {
      const res = await removeCommissionPayout(p.id);
      if (res.error) return setRowError(res.error);
      router.refresh();
    });
  }

  return (
    <section style={{ marginTop: 28 }}>
      <div className="module-toolbar">
        <div>
          <h2 className="module-title">Payments &amp; advances</h2>
          <p className="module-sub">
            Money already handed over. Every entry here is deducted from that
            salesperson&rsquo;s balance due.
          </p>
        </div>
        {canRecord && (
          <div className="toolbar-actions">
            <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
              Record payment
            </button>
          </div>
        )}
      </div>

      {payouts.length === 0 ? (
        <div className="empty-state">
          <p className="empty-label">Nothing recorded yet</p>
          <p className="empty-hint">
            {canRecord
              ? "When you pay a salesperson — or give an advance before a job settles — record it here so the balance due stays honest."
              : "Commission payments and advances recorded for you will show here."}
          </p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                {everyone && <th>Salesperson</th>}
                <th>Against</th>
                <th>Type</th>
                <th>Note</th>
                <th className="right">Amount</th>
                {canRecord && <th />}
              </tr>
            </thead>
            <tbody>
              {payouts.map((p) => (
                <tr key={p.id}>
                  <td>{shortDate(p.paidOn)}</td>
                  {everyone && <td>{p.repName}</td>}
                  <td>
                    {p.docNumber ? (
                      <>
                        {p.docNumber}
                        {p.jobTitle && <div className="est-tax-note">{p.jobTitle}</div>}
                      </>
                    ) : (
                      <span className="est-tax-note">General — not tied to a job</span>
                    )}
                  </td>
                  {/* An advance is money given before the job settled; it
                      explains the statement line "less advance". */}
                  <td>{p.kind === "advance" ? <strong>Advance</strong> : "Payout"}</td>
                  <td className="est-tax-note">{p.note || "—"}</td>
                  <td className="right mono">{moneyCents(p.amountCents)}</td>
                  {canRecord && (
                    <td className="right">
                      <button
                        type="button"
                        className="btn-ghost est-record-btn"
                        disabled={pending}
                        title="Remove a mis-keyed or duplicate entry"
                        onClick={() => remove(p)}
                      >
                        Remove
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rowError && <p className="error-note">{rowError}</p>}

      {open && (
        <Modal title="Record a commission payment" onClose={() => setOpen(false)}>
          <label className="field">
            <span className="field-label">Paid to</span>
            <select
              value={repId}
              onChange={(e) => {
                setRepId(e.target.value);
                setEstimateId("");
              }}
              disabled={pending}
            >
              <option value="">Pick a salesperson…</option>
              {repDropdownOptions(reps, [repId]).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label className="field">
              <span className="field-label">Amount</span>
              <input
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={pending}
              />
            </label>
            <label className="field">
              <span className="field-label">Paid on</span>
              <input
                type="date"
                value={paidOn}
                onChange={(e) => setPaidOn(e.target.value)}
                disabled={pending}
              />
            </label>
          </div>

          <label className="field">
            <span className="field-label">Against job (optional)</span>
            <select
              value={estimateId}
              onChange={(e) => {
                setEstimateId(e.target.value);
                // Money against a job that hasn't settled is an advance;
                // suggested, not forced — the box below stays editable.
                const job = jobs.find((j) => j.estimateId === e.target.value);
                if (job) setAdvance(job.held);
              }}
              disabled={pending || !repId}
            >
              <option value="">Not tied to a job</option>
              {jobs.map((j) => (
                <option key={j.estimateId} value={j.estimateId}>
                  {j.label}
                </option>
              ))}
            </select>
          </label>

          <label
            className="field"
            style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
          >
            <input
              type="checkbox"
              checked={advance}
              onChange={(e) => setAdvance(e.target.checked)}
              disabled={pending}
            />
            <span>
              This is an advance — given before the commission came due, deducted from
              their balance like any payment
            </span>
          </label>

          <label className="field">
            <span className="field-label">Note (optional)</span>
            <input
              placeholder="Check #, cash, Zelle…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={pending}
            />
          </label>

          {error && <p className="error-note">{error}</p>}

          <div className="est-pay-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={save}
              disabled={pending || !repId || centsFromInput(amount) <= 0}
            >
              {pending
                ? "Saving…"
                : `Record ${advance ? "advance" : "payment"}${
                    centsFromInput(amount) > 0 ? ` ${moneyCents(centsFromInput(amount))}` : ""
                  }`}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
