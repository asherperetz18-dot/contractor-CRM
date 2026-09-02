"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import {
  MANUAL_PAYMENT_METHODS,
  centsFromInput,
  moneyCents,
  type ManualPaymentMethod,
} from "@/lib/data/types";
import { requestPhaseNow } from "@/lib/actions/receivables";
import { recordManualPayment } from "@/lib/actions/manual-payments";

export type ReceivableRow = {
  phaseId: string;
  estimateId: string;
  title: string;
  phase: string;
  requestedAt: string;
  dueDate: string | null;
  remainingCents: number;
  customer: string;
  address: string | null;
  rep: string | null;
};

export type BillableRow = {
  phaseId: string;
  estimateId: string;
  title: string;
  phase: string;
  amountCents: number;
  customer: string;
  address: string | null;
  rep: string | null;
};

const DAY = 86400000;
const ageDays = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / DAY);

export function CollectView({
  unpaid,
  billable,
}: {
  unpaid: ReceivableRow[];
  billable: BillableRow[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"unpaid" | "billable">("unpaid");
  const [search, setSearch] = useState("");
  const [collecting, setCollecting] = useState<ReceivableRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const buckets = {
    current: unpaid.filter((r) => ageDays(r.requestedAt) <= 30),
    mid: unpaid.filter((r) => ageDays(r.requestedAt) > 30 && ageDays(r.requestedAt) <= 90),
    old: unpaid.filter((r) => ageDays(r.requestedAt) > 90),
  };
  const sum = (rows: { remainingCents: number }[]) =>
    rows.reduce((s, r) => s + r.remainingCents, 0);
  const totalOut = sum(unpaid);
  const billableTotal = billable.reduce((s, r) => s + r.amountCents, 0);

  const q = search.trim().toLowerCase();
  const match = (r: { title: string; phase: string; customer: string }) =>
    !q ||
    r.title.toLowerCase().includes(q) ||
    r.phase.toLowerCase().includes(q) ||
    r.customer.toLowerCase().includes(q);
  const shownUnpaid = unpaid.filter(match);
  const shownBillable = billable.filter(match);

  async function run(fn: () => Promise<{ error?: string; ok?: boolean; warning?: string }>) {
    setBusy(true);
    setError("");
    const res = await fn();
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return false;
    }
    router.refresh();
    return true;
  }

  const fmt = (iso: string | null) =>
    iso
      ? new Date(iso.length === 10 ? iso + "T00:00:00" : iso).toLocaleDateString(undefined, {
          month: "2-digit",
          day: "2-digit",
          year: "numeric",
        })
      : "—";

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Money to Collect</h1>
          <p className="module-sub">
            Outstanding receivables · unpaid invoices sorted oldest first · {unpaid.length} open
          </p>
        </div>
      </div>

      <div className="stat-grid stat-grid-5">
        <div className="stat-card stat-static">
          <div className="stat-value mono">{moneyCents(totalOut)}</div>
          <div className="stat-label">Total Outstanding</div>
        </div>
        <div className={"stat-card stat-static" + (buckets.old.length ? " digest-urgent" : "")}>
          <div className="stat-value mono">{moneyCents(sum(buckets.old))}</div>
          <div className="stat-label">90+ Days · {buckets.old.length} urgent</div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono">{moneyCents(sum(buckets.mid))}</div>
          <div className="stat-label">31–90 Days · {buckets.mid.length} follow up</div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono">{moneyCents(sum(buckets.current))}</div>
          <div className="stat-label">Current (0–30) · {buckets.current.length} on track</div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono">{moneyCents(billableTotal)}</div>
          <div className="stat-label">Billable Now · {billable.length} phases not invoiced</div>
        </div>
      </div>

      {totalOut > 0 && (
        <div className="collect-aging" aria-hidden>
          <span
            className="collect-aging-current"
            style={{ flexGrow: Math.max(sum(buckets.current), 1) }}
          />
          <span className="collect-aging-mid" style={{ flexGrow: Math.max(sum(buckets.mid), 1) }} />
          <span className="collect-aging-old" style={{ flexGrow: Math.max(sum(buckets.old), 1) }} />
        </div>
      )}

      <div className="filter-bar">
        <button
          type="button"
          className={"chip" + (tab === "unpaid" ? " chip-active" : "")}
          onClick={() => setTab("unpaid")}
        >
          Unpaid Invoices {unpaid.length > 0 && <span className="count-pill">{unpaid.length}</span>}
        </button>
        <button
          type="button"
          className={"chip" + (tab === "billable" ? " chip-active" : "")}
          onClick={() => setTab("billable")}
        >
          Billable Now {billable.length > 0 && <span className="count-pill">{billable.length}</span>}
        </button>
        <input
          className="ur-search"
          style={{ maxWidth: 320, marginBottom: 0, marginLeft: "auto" }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search projects, phases, customers…"
        />
      </div>

      {error && <p className="error-note">{error}</p>}

      {tab === "unpaid" ? (
        shownUnpaid.length === 0 ? (
          <div className="empty-state">
            <p className="empty-label">Nothing outstanding</p>
            <p className="empty-hint">Every requested phase is paid — the good outcome.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Rep</th>
                  <th>Project</th>
                  <th>Phase / Draw</th>
                  <th>Inv. Date</th>
                  <th className="right">Amount</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {shownUnpaid.map((r) => {
                  const age = ageDays(r.requestedAt);
                  return (
                    <tr key={r.phaseId}>
                      <td>{r.rep ?? "—"}</td>
                      <td>
                        <Link href={`/estimates/${r.estimateId}`} className="ur-name">
                          {r.title}
                        </Link>
                        <div className="est-tax-note">
                          {r.customer}
                          {r.address ? ` · ${r.address}` : ""}
                        </div>
                      </td>
                      <td>{r.phase}</td>
                      <td className="mono">
                        {fmt(r.requestedAt)}
                        <div
                          className={
                            "est-tax-note" + (age > 90 ? " proj-check-overdue" : "")
                          }
                        >
                          {age}d ago
                        </div>
                      </td>
                      <td className="right mono">{moneyCents(r.remainingCents)}</td>
                      <td className="right">
                        <button
                          className="btn-primary small"
                          disabled={busy}
                          onClick={() => setCollecting(r)}
                        >
                          💵 Record payment
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : shownBillable.length === 0 ? (
        <div className="empty-state">
          <p className="empty-label">Everything is invoiced</p>
          <p className="empty-hint">No phase on a signed contract is waiting to be billed.</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Rep</th>
                <th>Project</th>
                <th>Phase / Draw</th>
                <th className="right">Amount</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shownBillable.map((r) => (
                <tr key={r.phaseId}>
                  <td>{r.rep ?? "—"}</td>
                  <td>
                    <Link href={`/estimates/${r.estimateId}`} className="ur-name">
                      {r.title}
                    </Link>
                    <div className="est-tax-note">
                      {r.customer}
                      {r.address ? ` · ${r.address}` : ""}
                    </div>
                  </td>
                  <td>{r.phase}</td>
                  <td className="right mono">{moneyCents(r.amountCents)}</td>
                  <td className="right">
                    <button
                      className="btn-primary small"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Bill "${r.phase}" (${moneyCents(r.amountCents)}) now? It lands on the customer's portal with a one-week due date. Nothing is sent.`
                          )
                        )
                          void run(() => requestPhaseNow(r.phaseId));
                      }}
                    >
                      Request now
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {collecting && (
        <CollectPaymentModal
          row={collecting}
          busy={busy}
          onSave={async (input) => {
            const ok = await run(() =>
              recordManualPayment({
                estimateId: collecting.estimateId,
                phaseId: collecting.phaseId,
                ...input,
              })
            );
            if (ok) setCollecting(null);
          }}
          onClose={() => setCollecting(null)}
        />
      )}
    </div>
  );
}

function CollectPaymentModal({
  row,
  busy,
  onSave,
  onClose,
}: {
  row: ReceivableRow;
  busy: boolean;
  onSave: (input: {
    amountCents: number;
    method: ManualPaymentMethod;
    reference?: string;
    receivedOn?: string;
    cleared?: boolean;
  }) => void;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState((row.remainingCents / 100).toFixed(2));
  const [method, setMethod] = useState<ManualPaymentMethod>("check");
  const [reference, setReference] = useState("");
  const [receivedOn, setReceivedOn] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [cleared, setCleared] = useState(true);

  return (
    <Modal
      title={`Record payment — ${row.customer}`}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="module-sub" style={{ marginTop: 0 }}>
        {moneyCents(row.remainingCents)} outstanding on {row.phase} ({row.title}).
      </p>
      <div className="qr-form">
        <div className="qr-pair">
          <label className="field">
            <span>Amount</span>
            <input
              inputMode="decimal"
              value={amount}
              disabled={busy}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Method</span>
            <select
              value={method}
              disabled={busy}
              onChange={(e) => setMethod(e.target.value as ManualPaymentMethod)}
            >
              {MANUAL_PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="qr-pair">
          <label className="field">
            <span>Received on</span>
            <input
              type="date"
              value={receivedOn}
              disabled={busy}
              onChange={(e) => setReceivedOn(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Reference</span>
            <input
              value={reference}
              disabled={busy}
              onChange={(e) => setReference(e.target.value)}
              placeholder="check # (optional)"
            />
          </label>
        </div>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={cleared}
            disabled={busy}
            onChange={(e) => setCleared(e.target.checked)}
          />
          Money has arrived (uncheck for a cheque not yet banked)
        </label>
      </div>
      <div className="modal-actions">
        <button type="button" className="btn-ghost" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={() =>
            onSave({ amountCents: centsFromInput(amount), method, reference, receivedOn, cleared })
          }
        >
          {busy ? "Recording…" : "Record payment"}
        </button>
      </div>
    </Modal>
  );
}
