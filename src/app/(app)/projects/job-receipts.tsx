"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  fileCostsToContract,
  getJobExpenses,
  getJobFilingOptions,
} from "@/lib/actions/job-expenses";
import { getOpenJobBills } from "@/lib/actions/vendor-bills";
import { getInvoiceSetup } from "@/lib/actions/invoices";
import { getVendors } from "@/lib/actions/vendors";
import { Modal } from "@/components/ui/modal";
import { ReceiptThumb } from "@/components/ui/receipt-peek";
import { AttachExpenseReceipt, EditPaidBillModal } from "@/components/bills/edit-paid-bill-modal";
import type { BillJobOption } from "@/components/bills/add-bill-modal";
import { expenseEditLock } from "@/lib/data/expense-edit";
import {
  moneyCents,
  vendorLabel,
  type ContractFilingOption,
  type JobExpense,
  type Vendor,
} from "@/lib/data/types";
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
 *
 * On a customer with several contracts it also says which contract each
 * paid bill counts toward -- the commission report only counts a bill
 * on the contract it is filed to, so a bill here with no contract is
 * one no commission sees. The row's own contract is one click away.
 */
export function JobReceipts({
  leadId,
  estimateId,
  jobLabel,
  canEdit,
  jobs,
  onBillToClient,
  onClose,
}: {
  leadId: string;
  /** The project row's contract: "Assign to" files bills here. */
  estimateId: string;
  jobLabel: string;
  /** Edit / Attach on the paid rows (the cost-write roles). */
  canEdit: boolean;
  jobs: BillJobOption[];
  /** "Bill to client" on a paid cost: opens a new invoice starting from
   *  it. Absent for roles that can't invoice. */
  onBillToClient?: (costId: string) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<JobExpense[] | null>(null);
  const [open, setOpen] = useState<OpenJobBill[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<JobExpense | null>(null);
  const [filing, setFiling] = useState<{
    options: ContractFilingOption[];
    phaseContract: Record<string, string>;
  }>({ options: [], phaseContract: {} });
  const [assigning, setAssigning] = useState(false);
  // Cost id -> the invoice it's already billed on.
  const [billedOn, setBilledOn] = useState<Record<string, string>>({});
  // Bumped after an edit, attach or delete so the lists reload.
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [res, bills, vend, fil, inv] = await Promise.all([
        getJobExpenses(leadId),
        getOpenJobBills(leadId),
        getVendors(true),
        getJobFilingOptions(leadId),
        onBillToClient ? getInvoiceSetup(leadId) : Promise.resolve(null),
      ]);
      if (cancelled) return;
      setBilledOn(
        Object.fromEntries(
          (inv?.setup?.costs ?? []).filter((c) => c.billedOn).map((c) => [c.id, c.billedOn as string])
        )
      );
      if (res.error) setError(res.error);
      setRows(res.expenses ?? []);
      setOpen(bills.bills ?? []);
      setVendors(vend.vendors ?? []);
      setFiling({ options: fil.options ?? [], phaseContract: fil.phaseContract ?? {} });
    })();
    return () => {
      cancelled = true;
    };
    // onBillToClient only switches the lookup on; a new function
    // identity each render must not reload the window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, reload]);

  const vendorById = new Map(vendors.map((v) => [v.id, v]));
  const nameOf = (vendorId: string | null, text: string | null) => {
    const vend = vendorId ? vendorById.get(vendorId) : null;
    return vend ? vendorLabel(vend) : text || "—";
  };
  const total = (rows ?? []).reduce((s, r) => s + r.amount_cents, 0);
  const unpaid = open.reduce((s, b) => s + b.remaining_cents, 0);

  // Only a customer with several contracts has anything to sort out: with
  // one, every bill is that contract's.
  const multi = filing.options.length > 1;
  const docNumber = (id: string) =>
    filing.options.find((o) => o.estimateId === id)?.label.split(" · ")[0] ?? "Another contract";
  const contractOf = (r: JobExpense) =>
    r.estimate_payment_id ? (filing.phaseContract[r.estimate_payment_id] ?? null) : null;
  const unassigned = multi ? (rows ?? []).filter((r) => !contractOf(r)) : [];
  const unassignedCents = unassigned.reduce((s, r) => s + r.amount_cents, 0);
  const onThis = multi
    ? (rows ?? []).filter((r) => contractOf(r) === estimateId).reduce((s, r) => s + r.amount_cents, 0)
    : total;
  const thisDoc = filing.options.some((o) => o.estimateId === estimateId)
    ? docNumber(estimateId)
    : null;

  async function assign(ids: string[]) {
    setAssigning(true);
    setError("");
    const res = await fileCostsToContract(ids, estimateId);
    setAssigning(false);
    if (res.error) return setError(res.error);
    setReload((n) => n + 1);
  }

  return (
    <>
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
            {unassigned.length > 0 && (
              <div className="stmt-warning">
                <strong>
                  {unassigned.length} bill{unassigned.length === 1 ? "" : "s"} (
                  {moneyCents(unassignedCents)}) {unassigned.length === 1 ? "isn't" : "aren't"}{" "}
                  assigned to a contract.
                </strong>{" "}
                This customer has {filing.options.length} contracts, so sales commission counts{" "}
                {unassigned.length === 1 ? "it" : "them"} toward none of them.
                {canEdit && thisDoc && (
                  <div style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      className="btn-primary small"
                      disabled={assigning}
                      onClick={() => void assign(unassigned.map((r) => r.id))}
                    >
                      {assigning ? "Assigning…" : `Assign all ${unassigned.length} to ${thisDoc}`}
                    </button>{" "}
                    <span className="est-tax-note">
                      or use each row&rsquo;s button if some belong to another contract.
                    </span>
                  </div>
                )}
              </div>
            )}
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
                      {multi && <th>Contract</th>}
                      <th className="right">Amount</th>
                      {(canEdit || onBillToClient) && <th></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td>
                          {r.receipt_url ? (
                            <ReceiptThumb url={r.receipt_url} path={r.receipt_path ?? null} />
                          ) : canEdit && !expenseEditLock(r) ? (
                            <AttachExpenseReceipt
                              expense={r}
                              onError={setError}
                              onDone={() => setReload((n) => n + 1)}
                            />
                          ) : (
                            <span className="est-tax-note">none</span>
                          )}
                        </td>
                        <td>{fmtDay(r.spent_on)}</td>
                        <td>{nameOf(r.vendor_id, r.vendor)}</td>
                        <td>
                          {r.description || r.category || "—"}
                          {r.source === "bill" && (
                            <div className="est-tax-note">
                              a bill payment — change it in <Link href="/bills">Bills to Pay</Link>
                            </div>
                          )}
                        </td>
                        {multi && (
                          <td>
                            {contractOf(r) ? (
                              contractOf(r) === estimateId ? (
                                <strong>{docNumber(estimateId)}</strong>
                              ) : (
                                <span className="est-tax-note">{docNumber(contractOf(r)!)}</span>
                              )
                            ) : canEdit && thisDoc ? (
                              <button
                                type="button"
                                className="btn-ghost small"
                                disabled={assigning}
                                title="Not assigned to a contract, so no commission counts it"
                                onClick={() => void assign([r.id])}
                              >
                                ⚠ Assign to {thisDoc}
                              </button>
                            ) : (
                              <span className="stmt-warning-inline">⚠ Not assigned</span>
                            )}
                          </td>
                        )}
                        <td className="right mono">{moneyCents(r.amount_cents)}</td>
                        {(canEdit || onBillToClient) && (
                          <td className="right">
                            <span className="inv-row-actions">
                              {onBillToClient &&
                                (billedOn[r.id] ? (
                                  <span className="est-tax-note">Billed on {billedOn[r.id]}</span>
                                ) : (
                                  <button
                                    type="button"
                                    className="btn-ghost small inv-bill-btn"
                                    title="Invoice the customer for this cost"
                                    onClick={() => onBillToClient(r.id)}
                                  >
                                    Bill to client
                                  </button>
                                ))}
                              {canEdit && !expenseEditLock(r) && (
                                <button className="btn-ghost small" onClick={() => setEditing(r)}>
                                  ✎ Edit
                                </button>
                              )}
                            </span>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={multi ? 5 : 4}>
                        <strong>Total spent{multi ? " — every contract" : ""}</strong>
                      </td>
                      <td className="right mono">
                        <strong>{moneyCents(total)}</strong>
                      </td>
                      {(canEdit || onBillToClient) && <td></td>}
                    </tr>
                    {multi && thisDoc && (
                      /* The number commission uses for this row's job. */
                      <tr>
                        <td colSpan={5}>Counted on {thisDoc} (what its commission uses)</td>
                        <td className="right mono">{moneyCents(onThis)}</td>
                        {(canEdit || onBillToClient) && <td></td>}
                      </tr>
                    )}
                  </tfoot>
                </table>
              </div>
            )}
          </>
        )}
      </Modal>
      {editing && (
        // Beside the Bills window, not inside it -- Modal has no portal,
        // and nested it would render inside this one's scrolling body.
        <EditPaidBillModal
          expense={editing}
          jobs={jobs}
          vendors={vendors}
          onSaved={() => setReload((n) => n + 1)}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
