"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { moneyCents } from "@/lib/data/types";
import {
  createChangeOrder,
  getChangeOrders,
  type ChangeOrderRow,
} from "@/lib/actions/change-orders";

/**
 * Change orders against a signed contract.
 *
 * Only shown once the contract is signed. Before that there is nothing
 * to change -- the estimate itself is still editable, and offering both
 * would invite someone to raise a change order against a document the
 * customer has not agreed to yet.
 */
export function ChangeOrders({
  estimateId,
  contractTotalCents,
  canEdit,
}: {
  estimateId: string;
  contractTotalCents: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [orders, setOrders] = useState<ChangeOrderRow[] | null>(null);
  const [title, setTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await getChangeOrders(estimateId);
      if (cancelled) return;
      if (res.error) return setError(res.error);
      setOrders(res.orders ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [estimateId]);

  function create() {
    setError("");
    startTransition(async () => {
      const res = await createChangeOrder(estimateId, title);
      if (res.error) return setError(res.error);
      if (res.id) router.push(`/estimates/${res.id}`);
    });
  }

  if (!orders) return null;

  // Signed ones only. A draft change order is a proposal, and adding it
  // to the job total would report money nobody has agreed to.
  const signedTotal = orders
    .filter((o) => o.status === "Signed")
    .reduce((sum, o) => sum + o.total_cents, 0);

  return (
    <section className="est-pay" style={{ marginTop: 18 }}>
      <div className="module-toolbar" style={{ marginBottom: 10 }}>
        <div>
          <strong>Change orders</strong>
          <div className="est-tax-note">
            Extra or reduced work, signed by the customer before it starts
          </div>
        </div>
        {canEdit && !adding && (
          <button className="btn-ghost" onClick={() => setAdding(true)}>
            + New change order
          </button>
        )}
      </div>

      {adding && (
        <div className="est-record">
          <label className="field">
            <span className="field-label">What is changing?</span>
            <input
              className="est-item-name"
              autoFocus
              placeholder="e.g. Add recessed lighting to living room"
              value={title}
              disabled={pending}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && title.trim()) create();
              }}
            />
          </label>
          <div className="est-pay-actions">
            <button className="btn-primary" onClick={create} disabled={pending || !title.trim()}>
              {pending ? "Creating…" : "Create"}
            </button>
            <button className="btn-ghost" onClick={() => setAdding(false)} disabled={pending}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="error-note">{error}</p>}

      {orders.length === 0 ? (
        <p className="empty-hint">
          None yet. A change order is how extra work gets agreed in writing — this
          contract requires one before any of it starts.
        </p>
      ) : (
        <>
          <table className="data-table est-pay-table">
            <thead>
              <tr>
                <th>Change order</th>
                <th>Status</th>
                <th className="right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr
                  key={o.id}
                  className="est-row"
                  onClick={() => router.push(`/estimates/${o.id}`)}
                  role="link"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") router.push(`/estimates/${o.id}`);
                  }}
                >
                  <td>
                    <span className="mono">{o.doc_number}</span>
                    <div className="est-tax-note">{o.title}</div>
                  </td>
                  <td data-label="Status">
                    <span className={"est-badge est-badge-" + o.status.toLowerCase()}>
                      {o.status}
                    </span>
                  </td>
                  <td className="right mono" data-label="Amount">
                    {moneyCents(o.total_cents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Shown as an addition, never as a rewritten contract total.
              What the customer signed still says what it said. */}
          {signedTotal !== 0 && (
            <p className="hint-note" style={{ marginTop: 10 }}>
              Contract {moneyCents(contractTotalCents)} + signed change orders{" "}
              {moneyCents(signedTotal)} ={" "}
              <strong>{moneyCents(contractTotalCents + signedTotal)}</strong>
            </p>
          )}
        </>
      )}
    </section>
  );
}
