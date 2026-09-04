"use client";

import { Fragment, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { Field } from "@/components/ui/field";
import { ReceiptThumb } from "@/components/ui/receipt-peek";
import { AddBillModal } from "@/components/bills/add-bill-modal";
import {
  billRemainingCents,
  centsFromInput,
  leadDisplayName,
  moneyCents,
  vendorLabel,
  type Lead,
  type Vendor,
} from "@/lib/data/types";
import {
  BILL_PAYMENT_METHODS,
  BILL_PAYMENT_METHOD_LABEL,
  billPaymentMethodLabel,
  billReferenceLabel,
  type BillPaymentMethod,
  type VendorBillRow as VendorBill,
  type VendorBillPaymentRow as VendorBillPayment,
} from "@/lib/data/bills";
import {
  deleteBillPayment,
  recordBillPayment,
  setBillReceipt,
  setBillSchedule,
  setBillVoided,
  updateVendorBill,
} from "@/lib/actions/vendor-bills";
import { createReceiptUploadUrl } from "@/lib/actions/job-expenses";
import { downscaleImage } from "@/lib/images/downscale";
import { createClient as createBrowserClient } from "@/lib/supabase/client";

type Tab = "outstanding" | "scheduled" | "paid" | "void";

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function fmtDay(s: string | null): string {
  if (!s) return "—";
  return new Date(s + "T00:00:00").toLocaleDateString(undefined, {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  });
}

/** The editable fields of one bill, in the edit dialog. */
type DraftBill = {
  vendorId: string;
  vendorName: string;
  leadId: string;
  reference: string;
  amount: string;
  billDate: string;
  dueDate: string;
  /** When the company plans to pay it -- the same date the row's box sets. */
  scheduledDate: string;
};

export function BillsView({
  bills,
  payments,
  vendors,
  jobLeads,
}: {
  bills: VendorBill[];
  payments: VendorBillPayment[];
  vendors: Vendor[];
  jobLeads: Lead[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("outstanding");
  const [flat, setFlat] = useState(false);
  const [through, setThrough] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<VendorBill | null>(null);
  const [paying, setPaying] = useState<VendorBill | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const vendorById = useMemo(() => new Map(vendors.map((v) => [v.id, v])), [vendors]);
  const leadById = useMemo(() => new Map(jobLeads.map((l) => [l.id, l])), [jobLeads]);
  const paymentsByBill = useMemo(() => {
    const m = new Map<string, VendorBillPayment[]>();
    for (const p of payments) {
      const list = m.get(p.bill_id) ?? [];
      list.push(p);
      m.set(p.bill_id, list);
    }
    return m;
  }, [payments]);

  const remaining = (b: VendorBill) => billRemainingCents(b, paymentsByBill.get(b.id) ?? []);
  const vendorName = (b: VendorBill) => {
    const v = b.vendor_id ? vendorById.get(b.vendor_id) : null;
    return v ? vendorLabel(v) : b.vendor_name || "—";
  };

  const live = bills.filter((b) => !b.voided_at);
  const open = live.filter((b) => remaining(b) > 0);

  // End of the current week, Sunday: "scheduled this week" means every
  // check planned to go out by then, past-due plans included.
  const weekEnd = (() => {
    const d = new Date();
    d.setDate(d.getDate() + (7 - d.getDay()));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  const t = today();
  const totalDue = open.reduce((s, b) => s + remaining(b), 0);
  const scheduledWeek = open
    .filter((b) => b.scheduled_date && b.scheduled_date <= weekEnd)
    .reduce((s, b) => s + remaining(b), 0);
  const overdue = open
    .filter((b) => b.scheduled_date && b.scheduled_date < t)
    .reduce((s, b) => s + remaining(b), 0);
  const unlinked = open.filter((b) => !b.lead_id).length;

  const scheduled = open.filter((b) => b.scheduled_date);
  const paid = live.filter((b) => remaining(b) === 0);
  const voided = bills.filter((b) => b.voided_at);

  let shown =
    tab === "outstanding" ? open : tab === "scheduled" ? scheduled : tab === "paid" ? paid : voided;
  if (tab === "scheduled" && through) {
    shown = shown.filter((b) => (b.scheduled_date ?? "") <= through);
  }

  // Grouped by job, the way bills are paid. Unlinked bills sit in their
  // own group at the end. Plain computation -- a few hundred rows at
  // most, and the compiler memoizes what it can.
  const groups = (() => {
    if (flat) return [{ key: "all", label: null as string | null, rows: shown }];
    const m = new Map<string, VendorBill[]>();
    for (const b of shown) {
      const k = b.lead_id ?? "~none";
      const list = m.get(k) ?? [];
      list.push(b);
      m.set(k, list);
    }
    return [...m.entries()]
      .sort(([a], [b]) => (a === "~none" ? 1 : b === "~none" ? -1 : a.localeCompare(b)))
      .map(([k, rows]) => {
        const lead = k === "~none" ? null : leadById.get(k);
        return {
          key: k,
          label:
            k === "~none"
              ? "No job — overhead"
              : lead
                ? `${leadDisplayName(lead)}${lead.address ? ` · ${lead.address}` : ""}`
                : "Unknown job",
          rows,
        };
      });
  })();

  async function run(fn: () => Promise<{ error?: string } | { error?: string; created?: number }>) {
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

  const tabDef: { key: Tab; label: string; count: number }[] = [
    { key: "outstanding", label: "All Outstanding", count: open.length },
    { key: "scheduled", label: "Scheduled", count: scheduled.length },
    { key: "paid", label: "Paid", count: paid.length },
    { key: "void", label: "Voided", count: voided.length },
  ];

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Bills to Pay</h1>
          <p className="module-sub">
            Unpaid vendor bills · cash-impact view · {open.length} open
          </p>
        </div>
        <div className="cr-range">
          <button className="btn-ghost small" onClick={() => setFlat((f) => !f)}>
            {flat ? "Group by job" : "Flat list"}
          </button>
          <button className="btn-primary" onClick={() => setAdding(true)}>
            + Add bill
          </button>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card stat-static">
          <div className="stat-value mono">{moneyCents(totalDue)}</div>
          <div className="stat-label">Total Due</div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono">{moneyCents(scheduledWeek)}</div>
          <div className="stat-label">Scheduled This Week (incl. past due)</div>
        </div>
        <div className={"stat-card stat-static" + (overdue > 0 ? " digest-urgent" : "")}>
          <div className="stat-value mono">{moneyCents(overdue)}</div>
          <div className="stat-label">Overdue (past sched. date)</div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono">{unlinked}</div>
          <div className="stat-label">Unlinked Bills</div>
        </div>
      </div>

      <div className="filter-bar">
        {tabDef.map(({ key, label, count }) => (
          <button
            key={key}
            type="button"
            className={"chip" + (tab === key ? " chip-active" : "")}
            onClick={() => setTab(key)}
          >
            {label} {count > 0 && <span className="count-pill">{count}</span>}
          </button>
        ))}
        {tab === "scheduled" && (
          <span className="cr-range" style={{ marginLeft: "auto" }}>
            Through{" "}
            <input
              type="date"
              value={through}
              onChange={(e) => setThrough(e.target.value)}
              aria-label="Scheduled through"
            />
            {through && (
              <span className="hint-note">
                {moneyCents(
                  shown.reduce((s, b) => s + remaining(b), 0)
                )}{" "}
                through {fmtDay(through)}
              </span>
            )}
          </span>
        )}
      </div>

      {error && <p className="error-note">{error}</p>}

      {shown.length === 0 ? (
        <div className="empty-state">
          <p className="empty-label">Nothing here</p>
          <p className="empty-hint">
            {tab === "outstanding"
              ? "Add the bills you owe — receipt attached — and this page becomes the company checkbook."
              : "Nothing in this tab yet."}
          </p>
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.key} className="bills-group">
            {g.label && (
              <div className="bills-group-head">
                <strong>{g.label}</strong>
                <span className="mono">
                  {moneyCents(g.rows.reduce((s, b) => s + remaining(b), 0))}
                </span>
              </div>
            )}
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Receipt</th>
                    <th>Vendor / Ref</th>
                    <th>Bill / Due</th>
                    <th>Scheduled</th>
                    <th className="right">Amount</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((b) => {
                    const rem = remaining(b);
                    const paidSome = rem > 0 && rem < b.amount_cents;
                    const rowPayments = paymentsByBill.get(b.id) ?? [];
                    const isOverdue = rem > 0 && b.scheduled_date && b.scheduled_date < t;
                    return (
                      <Fragment key={b.id}>
                        <tr>
                          <td>
                            {b.receipt_url ? (
                              <ReceiptThumb url={b.receipt_url} path={b.receipt_path ?? null} />
                            ) : b.voided_at ? (
                              <span className="est-tax-note">none</span>
                            ) : (
                              <AttachReceipt
                                bill={b}
                                busy={busy}
                                onError={setError}
                                onDone={() => router.refresh()}
                              />
                            )}
                          </td>
                          <td>
                            <strong>{vendorName(b)}</strong>
                            {b.reference && <div className="est-tax-note">{b.reference}</div>}
                            {flat && b.lead_id && leadById.get(b.lead_id) && (
                              <div className="est-tax-note">
                                {leadDisplayName(leadById.get(b.lead_id)!)}
                              </div>
                            )}
                          </td>
                          <td className="mono">
                            {fmtDay(b.bill_date)}
                            <div className="est-tax-note">{fmtDay(b.due_date)}</div>
                          </td>
                          <td>
                            {tab === "void" || rem === 0 ? (
                              <span className="est-tax-note">{fmtDay(b.scheduled_date)}</span>
                            ) : (
                              <input
                                type="date"
                                className={isOverdue ? "proj-check-overdue" : undefined}
                                value={b.scheduled_date ?? ""}
                                disabled={busy}
                                onChange={(e) =>
                                  void run(() => setBillSchedule(b.id, e.target.value || null))
                                }
                              />
                            )}
                            {isOverdue && <div className="stale-tag">● overdue</div>}
                          </td>
                          <td className="right mono">
                            {paidSome ? (
                              <>
                                <span className="est-tax-note">{moneyCents(b.amount_cents)} bill</span>
                                <div>{moneyCents(rem)} left</div>
                              </>
                            ) : (
                              moneyCents(rem === 0 ? b.amount_cents : b.amount_cents)
                            )}
                          </td>
                          <td className="right">
                            {rem > 0 && !b.voided_at && (
                              <button
                                className="btn-primary small"
                                disabled={busy}
                                onClick={() => setPaying(b)}
                              >
                                💵 Pay
                              </button>
                            )}{" "}
                            {rowPayments.length > 0 && (
                              <button
                                className="btn-ghost small"
                                onClick={() => setExpanded(expanded === b.id ? null : b.id)}
                              >
                                {rowPayments.length} payment{rowPayments.length === 1 ? "" : "s"}
                              </button>
                            )}{" "}
                            {!b.voided_at && rem === b.amount_cents && (
                              <button
                                className="btn-ghost small"
                                disabled={busy}
                                onClick={() => setEditing(b)}
                              >
                                Edit
                              </button>
                            )}{" "}
                            {rem === b.amount_cents && (
                              <button
                                className="btn-ghost small"
                                disabled={busy}
                                onClick={() => void run(() => setBillVoided(b.id, !b.voided_at))}
                              >
                                {b.voided_at ? "Un-void" : "Void"}
                              </button>
                            )}
                          </td>
                        </tr>
                        {expanded === b.id &&
                          rowPayments.map((p) => (
                            <tr key={p.id} className="bills-payment-row">
                              <td colSpan={4}>
                                <span className="est-tax-note">
                                  Paid {fmtDay(p.paid_on)}
                                  {billPaymentMethodLabel(p.method) ? ` · ${billPaymentMethodLabel(p.method)}` : ""}
                                  {p.check_number
                                    ? ` · ${p.method && p.method !== "check" ? "ref" : "check"} #${p.check_number}`
                                    : ""}
                                  {p.note ? ` · ${p.note}` : ""}
                                  {p.job_expense_id ? " · filed as job cost" : ""}
                                </span>
                              </td>
                              <td className="right mono">{moneyCents(p.amount_cents)}</td>
                              <td className="right">
                                <button
                                  className="icon-btn"
                                  aria-label="Delete payment"
                                  disabled={busy}
                                  onClick={() => {
                                    if (window.confirm("Delete this payment? Its job cost goes with it."))
                                      void run(() => deleteBillPayment(p.id));
                                  }}
                                >
                                  ✕
                                </button>
                              </td>
                            </tr>
                          ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}

      {adding && (
        // The same form Projects and Job costs use. Here it starts as
        // "not paid yet" -- this page is where vendor invoices arrive --
        // and allows a bill with no job (overhead). It stays open after
        // each save so a stack of invoices goes in one after another.
        <AddBillModal
          jobs={jobLeads.map((l) => ({
            leadId: l.id,
            label: `${leadDisplayName(l)}${l.address ? ` — ${l.address}` : ""}`,
          }))}
          canBills
          allowNoJob
          defaultPaid={false}
          vendors={vendors}
          onClose={() => setAdding(false)}
        />
      )}

      {editing && (
        <EditBillModal
          title={`Edit bill — ${vendorName(editing)}`}
          draft={{
            vendorId: editing.vendor_id ?? "",
            vendorName: editing.vendor_name ?? "",
            leadId: editing.lead_id ?? "",
            reference: editing.reference ?? "",
            amount: (editing.amount_cents / 100).toFixed(2),
            billDate: editing.bill_date ?? "",
            dueDate: editing.due_date ?? "",
            scheduledDate: editing.scheduled_date ?? "",
          }}
          receipt={editing.receipt_url ? { url: editing.receipt_url, path: editing.receipt_path ?? null } : null}
          vendors={vendors}
          jobLeads={jobLeads}
          busy={busy}
          onSave={async (d) => {
            const ok = await run(() =>
              updateVendorBill(editing.id, {
                vendorId: d.vendorId || null,
                vendorName: d.vendorName,
                leadId: d.leadId || null,
                reference: d.reference,
                amountCents: centsFromInput(d.amount),
                billDate: d.billDate || null,
                dueDate: d.dueDate || null,
                scheduledDate: d.scheduledDate || null,
              })
            );
            if (ok) setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}

      {paying && (
        <PaymentModal
          bill={paying}
          vendorName={vendorName(paying)}
          remainingCents={remaining(paying)}
          busy={busy}
          onSave={async (input) => {
            if (await run(() => recordBillPayment(paying.id, input))) setPaying(null);
          }}
          onClose={() => setPaying(null)}
        />
      )}
    </div>
  );
}

export function EditBillModal({
  title,
  draft: initial,
  receipt,
  vendors,
  jobLeads,
  busy,
  onSave,
  onClose,
}: {
  title: string;
  draft: DraftBill;
  /** The bill's receipt file, shown for context; attaching lives on the row. */
  receipt: { url: string; path: string | null } | null;
  vendors: Vendor[];
  jobLeads: Lead[];
  busy: boolean;
  onSave: (d: DraftBill) => void;
  onClose: () => void;
}) {
  const [d, setD] = useState(initial);
  const patch = (p: Partial<DraftBill>) => setD((cur) => ({ ...cur, ...p }));

  // Same stacked, labelled layout as the Add bill form. The old one-row
  // version had no labels and scrolled sideways, so "which date is this"
  // was a guess.
  return (
    <Modal title={title} onClose={() => { if (!busy) onClose(); }}>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="qr-form">
          <Field label="Job">
            <select value={d.leadId} onChange={(e) => patch({ leadId: e.target.value })}>
              <option value="">No job — overhead</option>
              {jobLeads.map((l) => (
                <option key={l.id} value={l.id}>
                  {leadDisplayName(l)}
                  {l.address ? ` — ${l.address}` : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Vendor">
            <select
              value={d.vendorId}
              onChange={(e) => patch({ vendorId: e.target.value, vendorName: "" })}
            >
              <option value="">Not on the list</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {vendorLabel(v)}
                </option>
              ))}
            </select>
          </Field>
          {!d.vendorId && (
            <Field label="Vendor name">
              <input
                placeholder="e.g. Home Depot"
                value={d.vendorName}
                onChange={(e) => patch({ vendorName: e.target.value })}
              />
            </Field>
          )}
          <Field label="What for">
            <input
              placeholder="e.g. Architectural plans"
              value={d.reference}
              onChange={(e) => patch({ reference: e.target.value })}
            />
          </Field>
          <div className="qr-pair">
            <Field label="Amount">
              <input
                inputMode="decimal"
                placeholder="0.00"
                value={d.amount}
                onChange={(e) => patch({ amount: e.target.value })}
              />
            </Field>
            <Field label="Bill date">
              <input type="date" value={d.billDate} onChange={(e) => patch({ billDate: e.target.value })} />
            </Field>
          </div>
          <div className="qr-pair">
            <Field label="Due date">
              <input type="date" value={d.dueDate} onChange={(e) => patch({ dueDate: e.target.value })} />
            </Field>
            <Field label="Planned pay date">
              <input
                type="date"
                value={d.scheduledDate}
                onChange={(e) => patch({ scheduledDate: e.target.value })}
              />
            </Field>
          </div>
        </div>
        <div className="bill-file-row">
          <span className="est-tax-note">Receipt:</span>
          {receipt ? (
            <ReceiptThumb url={receipt.url} path={receipt.path} />
          ) : (
            <span className="est-tax-note">none — use 📎 Attach on the bill&rsquo;s row</span>
          )}
        </div>
      </fieldset>
      <div className="modal-actions">
        <button type="button" className="btn-ghost" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => onSave(d)}>
          {busy ? "Saving…" : "Save bill"}
        </button>
      </div>
    </Modal>
  );
}

/**
 * The 📎 button on a bill that was entered without its receipt: pick
 * the photo or PDF, it uploads straight to storage and lands on the
 * bill -- and from there on every payment of it, and on the job.
 */
function AttachReceipt({
  bill,
  busy,
  onError,
  onDone,
}: {
  bill: VendorBill;
  busy: boolean;
  onError: (msg: string) => void;
  onDone: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function upload(file: File) {
    setUploading(true);
    onError("");
    try {
      const shrunk = await downscaleImage(file);
      const signed = await createReceiptUploadUrl(bill.lead_id, shrunk.name, shrunk.size);
      if (signed.error || !signed.path || !signed.token) {
        return onError(signed.error ?? "Could not start the receipt upload.");
      }
      const { error: uploadError } = await createBrowserClient()
        .storage.from("lead-files")
        .uploadToSignedUrl(signed.path, signed.token, shrunk, { contentType: shrunk.type || undefined });
      if (uploadError) return onError(uploadError.message);
      const res = await setBillReceipt(bill.id, {
        path: signed.path,
        fileName: shrunk.name,
        contentType: shrunk.type || null,
      });
      if (res.error) return onError(res.error);
      onDone();
    } catch {
      onError("Didn't upload — check your connection and try again.");
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*,application/pdf"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
        }}
      />
      <button
        type="button"
        className="btn-ghost small"
        title="Attach the receipt (photo or PDF)"
        disabled={busy || uploading}
        onClick={() => input.current?.click()}
      >
        {uploading ? "…" : "📎 Attach"}
      </button>
    </>
  );
}

export function PaymentModal({
  bill,
  vendorName,
  remainingCents,
  busy,
  onSave,
  onClose,
}: {
  bill: VendorBill;
  vendorName: string;
  remainingCents: number;
  busy: boolean;
  onSave: (input: {
    amountCents: number;
    paidOn: string;
    method: BillPaymentMethod;
    checkNumber?: string | null;
    note?: string | null;
  }) => void;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState((remainingCents / 100).toFixed(2));
  const [paidOn, setPaidOn] = useState(today());
  const [method, setMethod] = useState<BillPaymentMethod>("check");
  const [checkNumber, setCheckNumber] = useState("");
  const [note, setNote] = useState("");

  return (
    <Modal title={`Record payment — ${vendorName}`} onClose={() => { if (!busy) onClose(); }}>
      <p className="module-sub" style={{ marginTop: 0 }}>
        {moneyCents(remainingCents)} left on this bill
        {bill.reference ? ` (${bill.reference})` : ""}.
        {bill.lead_id
          ? " The payment files itself as this job's cost — Projects' Spent stays true with one entry."
          : ""}
      </p>
      <div className="qr-form">
        <label className="field">
          <span>Amount</span>
          <input inputMode="decimal" value={amount} disabled={busy} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <div className="qr-pair">
          <label className="field">
            <span>Paid on</span>
            <input type="date" value={paidOn} disabled={busy} onChange={(e) => setPaidOn(e.target.value)} />
          </label>
          <label className="field">
            <span>Paid by</span>
            <select
              value={method}
              disabled={busy}
              onChange={(e) => setMethod(e.target.value as BillPaymentMethod)}
            >
              {BILL_PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {BILL_PAYMENT_METHOD_LABEL[m]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          {/* The box is the same; its name follows the method -- a check
              has a number, Zelle a confirmation, a card its last four. */}
          <span>{billReferenceLabel(method)}</span>
          <input value={checkNumber} disabled={busy} onChange={(e) => setCheckNumber(e.target.value)} placeholder="optional" />
        </label>
        <label className="field">
          <span>Note</span>
          <input value={note} disabled={busy} onChange={(e) => setNote(e.target.value)} placeholder="optional" />
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
            onSave({ amountCents: centsFromInput(amount), paidOn, method, checkNumber, note })
          }
        >
          {busy ? "Recording…" : "Record payment"}
        </button>
      </div>
    </Modal>
  );
}
