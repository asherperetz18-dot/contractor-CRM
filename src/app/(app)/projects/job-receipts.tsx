"use client";

import { useEffect, useState } from "react";
import { getJobExpenses } from "@/lib/actions/job-expenses";
import { getVendors } from "@/lib/actions/vendors";
import { Modal } from "@/components/ui/modal";
import { ReceiptPeek } from "@/components/ui/receipt-peek";
import { moneyCents, vendorLabel, type JobExpense, type Vendor } from "@/lib/data/types";

/**
 * Every cost on one job, right off the project row -- date, supplier,
 * what it was for, the amount, and the receipt itself a hover away.
 * The same rows the estimate's cost panel files by phase; this view
 * answers the quicker question, "what has this job actually bought?".
 */
export function JobReceipts({
  leadId,
  jobLabel,
  onClose,
}: {
  leadId: string;
  jobLabel: string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<JobExpense[] | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [res, vend] = await Promise.all([getJobExpenses(leadId), getVendors(true)]);
      if (cancelled) return;
      if (res.error) setError(res.error);
      setRows(res.expenses ?? []);
      setVendors(vend.vendors ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  const vendorById = new Map(vendors.map((v) => [v.id, v]));
  const total = (rows ?? []).reduce((s, r) => s + r.amount_cents, 0);

  return (
    <Modal title={`Receipts — ${jobLabel}`} onClose={onClose} wide>
      {error && <p className="error-note">{error}</p>}
      {rows === null ? (
        <p className="empty-hint">Loading receipts…</p>
      ) : rows.length === 0 ? (
        <p className="empty-hint">No costs recorded on this job yet.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Vendor</th>
                <th>What for</th>
                <th className="right">Amount</th>
                <th>Receipt</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const vend = r.vendor_id ? vendorById.get(r.vendor_id) : null;
                return (
                  <tr key={r.id}>
                    <td>
                      {new Date(r.spent_on + "T00:00:00").toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </td>
                    <td>{vend ? vendorLabel(vend) : r.vendor || "—"}</td>
                    <td>{r.description || r.category || "—"}</td>
                    <td className="right mono">{moneyCents(r.amount_cents)}</td>
                    <td>
                      {r.receipt_url ? (
                        <ReceiptPeek url={r.receipt_url} path={r.receipt_path ?? null} />
                      ) : (
                        <span className="est-tax-note">none</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>
                  <strong>Total spent</strong>
                </td>
                <td className="right mono">
                  <strong>{moneyCents(total)}</strong>
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Modal>
  );
}
