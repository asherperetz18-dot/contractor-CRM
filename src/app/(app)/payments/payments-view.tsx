"use client";

import { useState } from "react";
import Link from "next/link";
import {
  moneyCents,
  phaseStateLabel,
  type PhaseState,
} from "@/lib/data/types";
import { matchesPaymentSearch } from "./payment-filters";
import { ManualPaymentTools } from "./manual-payment-tools";

/**
 * The three tables on the Payments page, behind one search box.
 *
 * The page grew past the point where scrolling finds a payment: one box
 * narrows every table at once by contract #, customer, phase or amount
 * (typed any way — "4500", "4,500", "$4,500.00"), and status chips cut
 * the billed-progress list to just Overdue / Billed / Paid. The stat
 * cards above stay company-wide — the headline numbers should never
 * quietly mean "the filtered subset".
 */

export type BilledPhaseRow = {
  id: string;
  estimateId: string | null;
  docNumber: string | null;
  customer: string;
  phase: string;
  dueDate: string | null;
  state: PhaseState;
  amountCents: number;
};

export type DepositChaseRow = {
  estimateId: string;
  docNumber: string;
  title: string;
  customer: string;
  totalCents: number;
  depositCents: number;
};

export type PaymentHistoryRow = {
  id: string;
  estimateId: string | null;
  docNumber: string | null;
  customer: string;
  kind: string;
  status: string;
  methodLabel: string;
  date: string;
  amountCents: number;
  manual: boolean;
};

function statusBadge(status: string) {
  if (status === "succeeded") return "signed";
  if (status === "failed") return "declined";
  return "sent";
}

function phaseBadge(state: PhaseState) {
  return state === "paid" ? "signed" : state === "overdue" ? "declined" : "sent";
}

const fmtDay = (iso: string | null) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-US") : "—";

export function PaymentsView({
  billed,
  chase,
  history,
  overdueCount,
  awaitingDepositCount,
  showTools,
  canRemove,
}: {
  billed: BilledPhaseRow[];
  chase: DepositChaseRow[];
  history: PaymentHistoryRow[];
  overdueCount: number;
  awaitingDepositCount: number;
  showTools: boolean;
  canRemove: boolean;
}) {
  const [search, setSearch] = useState("");
  const [chip, setChip] = useState<"all" | PhaseState>("all");

  const q = search.trim();

  // Chips only for states that actually exist on the page, so a company
  // with nothing overdue never sees a dead "Overdue" button.
  const stateCounts = new Map<PhaseState, number>();
  for (const r of billed) stateCounts.set(r.state, (stateCounts.get(r.state) ?? 0) + 1);
  const chips = (["overdue", "billed", "clearing", "paid"] as PhaseState[]).filter((s) =>
    stateCounts.has(s)
  );

  const shownBilled = billed.filter(
    (r) =>
      (chip === "all" || r.state === chip) &&
      matchesPaymentSearch(q, {
        texts: [r.docNumber, r.customer, r.phase],
        amountsCents: [r.amountCents],
      })
  );
  const shownChase = chase.filter((r) =>
    matchesPaymentSearch(q, {
      texts: [r.docNumber, r.title, r.customer],
      amountsCents: [r.totalCents, r.depositCents],
    })
  );
  const shownHistory = history.filter((r) =>
    matchesPaymentSearch(q, {
      texts: [r.docNumber, r.customer, r.kind, r.methodLabel],
      amountsCents: [r.amountCents],
    })
  );

  const filtering = Boolean(q) || chip !== "all";

  return (
    <div>
      <div className="filter-bar">
        {chips.length > 0 && (
          <>
            <button
              type="button"
              className={"chip" + (chip === "all" ? " chip-active" : "")}
              onClick={() => setChip("all")}
            >
              All <span className="count-pill">{billed.length}</span>
            </button>
            {chips.map((s) => (
              <button
                key={s}
                type="button"
                className={"chip" + (chip === s ? " chip-active" : "")}
                onClick={() => setChip(s)}
              >
                {phaseStateLabel(s)} <span className="count-pill">{stateCounts.get(s)}</span>
              </button>
            ))}
          </>
        )}
        <input
          className="ur-search"
          style={{ maxWidth: 320, marginBottom: 0, marginLeft: "auto" }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search contract #, customer, or amount…"
        />
        {filtering && (
          <button
            type="button"
            className="btn-ghost small"
            onClick={() => {
              setSearch("");
              setChip("all");
            }}
          >
            ✕ Clear
          </button>
        )}
      </div>

      {/* Billed progress payments: money already asked for. Overdue first,
          because that is the list somebody has to work today. */}
      {billed.length > 0 && (
        <section className="pay-section">
          <h2 className="pay-section-title">
            Billed progress payments
            {overdueCount > 0 ? ` — ${overdueCount} overdue` : ""}
            {filtering ? ` · ${shownBilled.length} of ${billed.length} match` : ""}
          </h2>
          {shownBilled.length === 0 ? (
            <p className="empty-hint">No billed phase matches these filters.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Contract</th>
                  <th>Phase</th>
                  <th>Due</th>
                  <th>Status</th>
                  <th className="right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {shownBilled.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.estimateId ? (
                        <Link className="link-plain" href={`/estimates/${r.estimateId}`}>
                          <span className="ur-name mono">{r.docNumber}</span>
                        </Link>
                      ) : (
                        <span className="ur-name mono">—</span>
                      )}
                      <div className="ur-add-phone">{r.customer}</div>
                    </td>
                    <td>{r.phase}</td>
                    <td>{fmtDay(r.dueDate)}</td>
                    <td>
                      <span className={"est-badge est-badge-" + phaseBadge(r.state)}>
                        {phaseStateLabel(r.state)}
                      </span>
                    </td>
                    <td className="right mono">{moneyCents(r.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {/* The only figure on this page that is a to-do list rather than a
          number: these are signed jobs where the deposit never landed. */}
      {chase.length > 0 && (
        <section className="pay-section">
          <h2 className="pay-section-title">
            Deposits to chase ({awaitingDepositCount})
            {filtering ? ` · ${shownChase.length} of ${chase.length} match` : ""}
          </h2>
          {shownChase.length === 0 ? (
            <p className="empty-hint">No unpaid deposit matches these filters.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Contract</th>
                  <th>Customer</th>
                  <th className="right">Contract value</th>
                  <th className="right">Deposit due</th>
                </tr>
              </thead>
              <tbody>
                {shownChase.map((r) => (
                  <tr key={r.estimateId}>
                    <td>
                      <Link className="link-plain" href={`/estimates/${r.estimateId}`}>
                        <span className="ur-name mono">{r.docNumber}</span>
                      </Link>
                      <div className="ur-add-phone">{r.title}</div>
                    </td>
                    <td>{r.customer}</td>
                    <td className="right mono">{moneyCents(r.totalCents)}</td>
                    <td className="right mono">{moneyCents(r.depositCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      <section className="pay-section">
        <h2 className="pay-section-title">
          Payment history
          {filtering ? ` · ${shownHistory.length} of ${history.length} match` : ""}
        </h2>
        {history.length === 0 ? (
          <div className="empty-state">
            <p className="empty-label">No payments yet</p>
            <p className="empty-hint">
              Once a customer signs and pays a deposit through the portal, it lands here with the
              method and date.
            </p>
          </div>
        ) : shownHistory.length === 0 ? (
          <p className="empty-hint">No payment matches these filters.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Contract</th>
                <th>Customer</th>
                <th>Kind</th>
                <th>Status</th>
                <th>Method</th>
                <th>Date</th>
                <th className="right">Amount</th>
                {showTools && <th></th>}
              </tr>
            </thead>
            <tbody>
              {shownHistory.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.estimateId ? (
                      <Link className="link-plain" href={`/estimates/${r.estimateId}`}>
                        <span className="ur-name mono">{r.docNumber}</span>
                      </Link>
                    ) : (
                      <span className="ur-name mono">—</span>
                    )}
                  </td>
                  <td>{r.customer}</td>
                  <td>{r.kind}</td>
                  <td>
                    <span className={"est-badge est-badge-" + statusBadge(r.status)}>
                      {r.status}
                    </span>
                  </td>
                  <td>{r.methodLabel}</td>
                  <td>{new Date(r.date).toLocaleDateString("en-US")}</td>
                  <td className="right mono">{moneyCents(r.amountCents)}</td>
                  {/* Only hand-recorded rows can be settled or removed
                      here. Stripe rows settle by webhook and are
                      refunded in Stripe. */}
                  {showTools && (
                    <td>
                      {r.manual && (
                        <ManualPaymentTools
                          paymentId={r.id}
                          status={r.status}
                          canRemove={canRemove}
                        />
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
