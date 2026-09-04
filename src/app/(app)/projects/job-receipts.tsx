"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getJobExpenses } from "@/lib/actions/job-expenses";
import { getOpenJobBills } from "@/lib/actions/vendor-bills";
import { getVendors } from "@/lib/actions/vendors";
import { Modal } from "@/components/ui/modal";
import { ReceiptThumb } from "@/components/ui/receipt-peek";
import { moneyCents, vendorLabel, type JobExpense, type Vendor } from "@/lib/data/types";
import type { OpenJobBill } from "@/lib/data/bills";

const fmtDay = (s: string) =>
  new Date(s + "T00:00:00").toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

/**
 * Every bill on one job, right off the project row -- what is still
 * owed on top, what has been paid below, each with the receipt itself
 * showing as a thumbnail. The same rows Bills to Pay and the contract's
 * Job costs show; this view answers the quicker question, "what has
 * this job bought, and what do we still owe on it?".
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
  const [open, setOpen] = useState<OpenJobBill[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [res, bills, vend] = await Promise.all([
        getJobExpenses(leadId),
        getOpenJobBills(leadId),
        getVendors(true),
      ]);
      if (cancelled) return;
      if (res.error) setError(res.error);
      setRows(res.expenses ?? []);
      setOpen(bills.bills ?? []);
      setVendors(vend.vendors ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  const vendorById = new Map(vendors.map((v) => [v.id, v]));
  const nameOf = (vendorId: string | null, text: string | null) => {
    const vend = vendorId ? vendorById.get(vendorId) : null;
    return vend ? vendorLabel(vend) : text || "—";
  };
  const total = (rows ?? []).reduce((s, r) => s + r.amount_cents, 0);
  const unpaid = open.reduce((s, b) => s + b.remaining_cents, 0);

  return (
    <Modal title={`Bills — ${jobLabel}`} onClose={onClose} wide>
      {error && <p className="error-note">{error}</p>}
      {rows === null ? (
        <p className="empty-hint">Loading bills…</p>
      ) : rows.length === 0 && open.length === 0 ? (
        <p className="empty-hint">No bills on this job yet.</p>
      ) : (
        <>
          {open.length > 0 && (
            <>
              <div className="bills-group-head">
                <strong>Not paid yet</strong>
                <span className="mono">{moneyCents(unpaid)}</span>
              </div>
              <div className="table-scroll" style={{ marginBottom: 14 }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Receipt</th>
                      <th>Bill date</th>
                      <th>Vendor</th>
                      <th>What for</th>
                      <th className="right">Left to pay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {open.map((b) => (
                      <tr key={b.id}>
                        <td>
                          {b.receipt_url ? (
                            <ReceiptThumb url={b.receipt_url} path={b.receipt_path} />
                          ) : (
                            <span className="est-tax-note">none</span>
                          )}
                        </td>
                        <td>{b.bill_date ? fmtDay(b.bill_date) : "—"}</td>
                        <td>{nameOf(b.vendor_id, b.vendor_name)}</td>
                        <td>{b.reference || "—"}</td>
                        <td className="right mono">
                          {moneyCents(b.remaining_cents)}
                          {b.remaining_cents < b.amount_cents && (
                            <div className="est-tax-note">of {moneyCents(b.amount_cents)}</div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="est-tax-note" style={{ marginTop: -8, marginBottom: 14 }}>
                Pay these from <Link href="/bills">Bills to Pay</Link> — each payment lands below
                as a cost.
              </p>
            </>
          )}

          <div className="bills-group-head">
            <strong>Paid</strong>
            <span className="mono">{moneyCents(total)}</span>
          </div>
          {rows.length === 0 ? (
            <p className="empty-hint">Nothing paid on this job yet.</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Receipt</th>
                    <th>Date paid</th>
                    <th>Vendor</th>
                    <th>What for</th>
                    <th className="right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        {r.receipt_url ? (
                          <ReceiptThumb url={r.receipt_url} path={r.receipt_path ?? null} />
                        ) : (
                          <span className="est-tax-note">none</span>
                        )}
                      </td>
                      <td>{fmtDay(r.spent_on)}</td>
                      <td>{nameOf(r.vendor_id, r.vendor)}</td>
                      <td>
                        {r.description || r.category || "—"}
                        {r.source === "bill" && <div className="est-tax-note">paid from Bills to Pay</div>}
                      </td>
                      <td className="right mono">{moneyCents(r.amount_cents)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4}>
                      <strong>Total spent</strong>
                    </td>
                    <td className="right mono">
                      <strong>{moneyCents(total)}</strong>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
