"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import {
  billRemainingCents,
  centsFromInput,
  leadDisplayName,
  moneyCents,
  vendorLabel,
  type Lead,
  type Vendor,
  type VendorBill,
  type VendorBillPayment,
} from "@/lib/data/types";
import {
  createVendorBills,
  deleteBillPayment,
  recordBillPayment,
  setBillSchedule,
  setBillVoided,
  updateVendorBill,
  type BillInput,
} from "@/lib/actions/vendor-bills";

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

/** A single editable bill row in the new/bulk dialog. */
type DraftBill = {
  vendorId: string;
  vendorName: string;
  leadId: string;
  reference: string;
  amount: string;
  billDate: string;
  dueDate: string;
};

const emptyDraft = (): DraftBill => ({
  vendorId: "",
  vendorName: "",
  leadId: "",
  reference: "",
  amount: "",
  billDate: today(),
  dueDate: "",
});

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
  const [drafts, setDrafts] = useState<DraftBill[] | null>(null);
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
          <button className="btn-primary" onClick={() => setDrafts([emptyDraft()])}>
            + Add bills
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
              ? "Add the bills you owe and this page becomes the company checkbook."
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
                      <>
                        <tr key={b.id}>
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
                              <td colSpan={3}>
                                <span className="est-tax-note">
                                  Paid {fmtDay(p.paid_on)}
                                  {p.check_number ? ` · check #${p.check_number}` : ""}
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
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}

      {drafts && (
        <BillDraftsModal
          drafts={drafts}
          setDrafts={setDrafts}
          vendors={vendors}
          jobLeads={jobLeads}
          busy={busy}
          onSave={async () => {
            const inputs: BillInput[] = drafts
              .filter((d) => d.amount.trim() || d.vendorId || d.vendorName.trim())
              .map((d) => ({
                vendorId: d.vendorId || null,
                vendorName: d.vendorName,
                leadId: d.leadId || null,
                reference: d.reference,
                amountCents: centsFromInput(d.amount),
                billDate: d.billDate || null,
                dueDate: d.dueDate || null,
              }));
            if (!inputs.length) return setError("Fill in at least one bill.");
            if (await run(() => createVendorBills(inputs))) setDrafts(null);
          }}
          onClose={() => setDrafts(null)}
        />
      )}

      {editing && (
        <BillDraftsModal
          title={`Edit bill — ${vendorName(editing)}`}
          drafts={[
            {
              vendorId: editing.vendor_id ?? "",
              vendorName: editing.vendor_name ?? "",
              leadId: editing.lead_id ?? "",
              reference: editing.reference ?? "",
              amount: (editing.amount_cents / 100).toFixed(2),
              billDate: editing.bill_date ?? "",
              dueDate: editing.due_date ?? "",
            },
          ]}
          setDrafts={() => {}}
          single
          vendors={vendors}
          jobLeads={jobLeads}
          busy={busy}
          onSaveSingle={async (d) => {
            const ok = await run(() =>
              updateVendorBill(editing.id, {
                vendorId: d.vendorId || null,
                vendorName: d.vendorName,
                leadId: d.leadId || null,
                reference: d.reference,
                amountCents: centsFromInput(d.amount),
                billDate: d.billDate || null,
                dueDate: d.dueDate || null,
                scheduledDate: editing.scheduled_date,
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

function BillDraftsModal({
  title,
  drafts,
  setDrafts,
  single,
  vendors,
  jobLeads,
  busy,
  onSave,
  onSaveSingle,
  onClose,
}: {
  title?: string;
  drafts: DraftBill[];
  setDrafts: (d: DraftBill[]) => void;
  single?: boolean;
  vendors: Vendor[];
  jobLeads: Lead[];
  busy: boolean;
  onSave?: () => void;
  onSaveSingle?: (d: DraftBill) => void;
  onClose: () => void;
}) {
  // Single-edit mode keeps its own copy; bulk mode edits the parent's.
  const [own, setOwn] = useState(drafts);
  const rows = single ? own : drafts;
  const setRows = single ? setOwn : setDrafts;
  const patch = (i: number, p: Partial<DraftBill>) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));

  return (
    <Modal title={title ?? "Add bills"} onClose={() => { if (!busy) onClose(); }} wide>
      {!single && (
        <p className="module-sub" style={{ marginTop: 0 }}>
          Row after row, the whole stack at once — pick the vendor, the job it belongs to,
          the amount, done.
        </p>
      )}
      <div className="bills-draft-list">
        {rows.map((d, i) => (
          <div key={i} className="bills-draft-row">
            <select
              value={d.vendorId}
              disabled={busy}
              onChange={(e) => patch(i, { vendorId: e.target.value, vendorName: "" })}
            >
              <option value="">Vendor not on the list</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {vendorLabel(v)}
                </option>
              ))}
            </select>
            {!d.vendorId && (
              <input
                placeholder="Vendor name"
                value={d.vendorName}
                disabled={busy}
                onChange={(e) => patch(i, { vendorName: e.target.value })}
              />
            )}
            <select
              value={d.leadId}
              disabled={busy}
              onChange={(e) => patch(i, { leadId: e.target.value })}
            >
              <option value="">No job (overhead)</option>
              {jobLeads.map((l) => (
                <option key={l.id} value={l.id}>
                  {leadDisplayName(l)}
                  {l.address ? ` — ${l.address}` : ""}
                </option>
              ))}
            </select>
            <input
              placeholder="Ref / what for"
              value={d.reference}
              disabled={busy}
              onChange={(e) => patch(i, { reference: e.target.value })}
            />
            <input
              inputMode="decimal"
              placeholder="0.00"
              style={{ width: 110 }}
              value={d.amount}
              disabled={busy}
              onChange={(e) => patch(i, { amount: e.target.value })}
            />
            <input
              type="date"
              title="Bill date"
              value={d.billDate}
              disabled={busy}
              onChange={(e) => patch(i, { billDate: e.target.value })}
            />
            <input
              type="date"
              title="Due date"
              value={d.dueDate}
              disabled={busy}
              onChange={(e) => patch(i, { dueDate: e.target.value })}
            />
            {!single && rows.length > 1 && (
              <button
                type="button"
                className="icon-btn"
                aria-label="Remove row"
                disabled={busy}
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
      {!single && (
        <button
          type="button"
          className="btn-ghost small"
          style={{ marginTop: 8 }}
          disabled={busy}
          onClick={() => setRows([...rows, emptyDraft()])}
        >
          + Another bill
        </button>
      )}
      <div className="modal-actions">
        <button type="button" className="btn-ghost" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={() => (single ? onSaveSingle?.(rows[0]) : onSave?.())}
        >
          {busy ? "Saving…" : single ? "Save bill" : `Save ${rows.length} bill${rows.length === 1 ? "" : "s"}`}
        </button>
      </div>
    </Modal>
  );
}

function PaymentModal({
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
  onSave: (input: { amountCents: number; paidOn: string; checkNumber?: string | null; note?: string | null }) => void;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState((remainingCents / 100).toFixed(2));
  const [paidOn, setPaidOn] = useState(today());
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
            <span>Check #</span>
            <input value={checkNumber} disabled={busy} onChange={(e) => setCheckNumber(e.target.value)} placeholder="optional" />
          </label>
        </div>
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
            onSave({ amountCents: centsFromInput(amount), paidOn, checkNumber, note })
          }
        >
          {busy ? "Recording…" : "Record payment"}
        </button>
      </div>
    </Modal>
  );
}
