"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Field } from "@/components/ui/field";
import { centsFromInput, moneyCents } from "@/lib/data/types";
import { invoiceDraftError, invoiceTotalCents, withMarkupCents } from "@/lib/data/invoices";
import {
  createInvoice,
  getInvoiceSetup,
  type InvoiceCostOption,
  type InvoiceSetup,
} from "@/lib/actions/invoices";
import { searchEstimateLeads, type EstimateLeadMatch } from "@/lib/actions/lead-search";

type Line = {
  key: number;
  name: string;
  description: string;
  /** Typed amount, for a line written by hand. */
  amount: string;
  /** The job cost it bills back, with that cost's own amount. */
  cost: InvoiceCostOption | null;
  showReceipt: boolean;
};

const DUE_OPTIONS = [
  [0, "On receipt"],
  [7, "In 7 days"],
  [15, "In 15 days"],
  [30, "In 30 days"],
] as const;

let nextKey = 1;
const costLine = (cost: InvoiceCostOption): Line => ({
  key: nextKey++,
  name: cost.description?.trim() || cost.category?.trim() || "Reimbursable cost",
  description: cost.vendorName ? `Paid to ${cost.vendorName}` : "",
  amount: "",
  cost,
  showReceipt: cost.hasReceipt,
});
const blankLine = (): Line => ({
  key: nextKey++,
  name: "",
  description: "",
  amount: "",
  cost: null,
  showReceipt: false,
});

/**
 * Bill a customer for something on top of the contract -- a permit fee,
 * a dumpster, plan copies. Lines come from the job's paid costs (at
 * cost unless markup is ticked, receipt shown to the customer) or are
 * typed in; sending issues the invoice and texts the Pay link.
 *
 * Opened from a project row (leadId + contract known), from a cost's
 * "Bill to client" (that cost pre-added), or from Quick Create with no
 * customer yet (a search picks one).
 */
export function NewInvoiceModal({
  leadId: initialLeadId,
  contractId,
  costId,
  onClose,
  onIssued,
}: {
  leadId?: string | null;
  contractId?: string | null;
  /** A cost to start from ("Bill to client" on a bill row). */
  costId?: string | null;
  onClose: () => void;
  onIssued: (result: { id: string; docNumber: string; note: string }) => void;
}) {
  const [leadId, setLeadId] = useState<string | null>(initialLeadId ?? null);
  const [setup, setSetup] = useState<InvoiceSetup | null>(null);
  const [parentId, setParentId] = useState<string>(contractId ?? "");
  const [title, setTitle] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [markup, setMarkup] = useState(false);
  const [markupPct, setMarkupPct] = useState("10");
  const [dueInDays, setDueInDays] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!leadId) return;
    let cancelled = false;
    getInvoiceSetup(leadId).then((res) => {
      if (cancelled) return;
      if (res.error || !res.setup) return setError(res.error ?? "Couldn't load this customer.");
      setSetup(res.setup);
      // The row's contract when it's one of theirs; the only one when
      // there's just one; otherwise let them pick (or none).
      const ids = res.setup.contracts.map((c) => c.id);
      setParentId((cur) =>
        cur && ids.includes(cur) ? cur : ids.length === 1 ? ids[0] : ""
      );
      const start = costId ? res.setup.costs.find((c) => c.id === costId && !c.billedOn) : null;
      setLines(start ? [costLine(start)] : [blankLine()]);
      if (costId && !start) {
        const billed = res.setup.costs.find((c) => c.id === costId);
        if (billed?.billedOn) setError(`That cost is already billed on ${billed.billedOn}.`);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [leadId, costId]);

  const markupBp = markup ? Math.round((Number(markupPct) || 0) * 100) : 0;
  const amountOf = (l: Line) =>
    l.cost ? withMarkupCents(l.cost.amountCents, markupBp) : centsFromInput(l.amount);
  const total = invoiceTotalCents(lines.map((l) => ({ amountCents: amountOf(l) })));
  const onInvoice = new Set(lines.map((l) => l.cost?.id).filter(Boolean));
  const billable = (setup?.costs ?? []).filter((c) => !c.billedOn && !onInvoice.has(c.id));
  const hasCostLine = lines.some((l) => l.cost);

  const patch = (key: number, p: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));

  async function send(delivery: "text" | "marked") {
    if (!leadId) return setError("Pick the customer first.");
    const drafts = lines.map((l) => ({
      name: l.name,
      description: l.description,
      amountCents: amountOf(l),
      sourceExpenseId: l.cost?.id ?? null,
      showReceipt: !!l.cost && l.showReceipt,
    }));
    const problem = invoiceDraftError(drafts);
    if (problem) return setError(problem);
    setError(null);
    setSaving(true);
    const res = await createInvoice({
      leadId,
      parentEstimateId: parentId || null,
      title,
      lines: drafts,
      dueInDays,
      delivery,
    });
    setSaving(false);
    if (res.error && !res.id) return setError(res.error);
    onIssued({
      id: res.id!,
      docNumber: res.docNumber ?? "The invoice",
      note:
        res.error ?? res.warning ??
        (res.sentTo
          ? `${res.docNumber} sent — Pay link texted to ${res.sentTo}.`
          : `${res.docNumber} issued. It's on the customer's portal with a Pay button.`),
    });
  }

  return (
    <Modal title="New invoice" onClose={() => { if (!saving) onClose(); }} wide>
      <fieldset disabled={saving} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="qr-form">
          {!leadId ? (
            <CustomerSearch onPick={(id) => setLeadId(id)} />
          ) : !setup ? (
            <p className="empty-hint">{error ? "" : "Loading…"}</p>
          ) : (
            <>
              <div className="qr-pair">
                <div className="field">
                  <span className="field-label">Customer</span>
                  <span className="inv-customer">
                    {setup.customer.name}
                    {!initialLeadId && (
                      <button
                        type="button"
                        className="btn-ghost small"
                        onClick={() => {
                          setLeadId(null);
                          setSetup(null);
                          setLines([]);
                          setParentId("");
                        }}
                      >
                        Change
                      </button>
                    )}
                  </span>
                </div>
                <Field label="For contract">
                  <select value={parentId} onChange={(e) => setParentId(e.target.value)}>
                    <option value="">No contract</option>
                    {setup.contracts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="What it's for (optional)">
                <input
                  placeholder="e.g. Permit fees"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </Field>

              <div className="inv-lines">
                {lines.map((l) => (
                  <div key={l.key} className="inv-line">
                    <div className="inv-line-main">
                      <input
                        aria-label="Description"
                        placeholder="Description, e.g. Plan check copies"
                        value={l.name}
                        onChange={(e) => patch(l.key, { name: e.target.value })}
                      />
                      <input
                        aria-label="Detail"
                        className="inv-line-detail"
                        placeholder="Detail (optional)"
                        value={l.description}
                        onChange={(e) => patch(l.key, { description: e.target.value })}
                      />
                      {l.cost && (
                        <div className="inv-line-src">
                          <span className="inv-src-chip">
                            From bill · {moneyCents(l.cost.amountCents)} paid{" "}
                            {new Date(l.cost.spentOn + "T00:00:00").toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                            })}
                          </span>
                          {l.cost.hasReceipt ? (
                            <label className="inv-check">
                              <input
                                type="checkbox"
                                checked={l.showReceipt}
                                onChange={(e) => patch(l.key, { showReceipt: e.target.checked })}
                              />
                              Show the receipt to the customer
                            </label>
                          ) : (
                            <span className="est-tax-note">No receipt on this bill</span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="inv-line-amount">
                      {l.cost ? (
                        <span className="mono">{moneyCents(amountOf(l))}</span>
                      ) : (
                        <input
                          aria-label="Amount"
                          inputMode="decimal"
                          placeholder="0.00"
                          value={l.amount}
                          onChange={(e) => patch(l.key, { amount: e.target.value })}
                        />
                      )}
                      <button
                        type="button"
                        className="btn-ghost est-row-remove"
                        aria-label="Remove line"
                        onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="inv-add-row">
                <button type="button" className="btn-ghost small" onClick={() => setLines((ls) => [...ls, blankLine()])}>
                  + Add line
                </button>
                {billable.length > 0 && (
                  <select
                    aria-label="Bill a job cost"
                    value=""
                    onChange={(e) => {
                      const cost = billable.find((c) => c.id === e.target.value);
                      if (cost) setLines((ls) => [...ls.filter((x) => x.cost || x.name || x.amount), costLine(cost)]);
                    }}
                  >
                    <option value="">+ Bill a job cost…</option>
                    {billable.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label} — {moneyCents(c.amountCents)}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {hasCostLine && (
                <div className="inv-markup">
                  <label className="inv-check">
                    <input type="checkbox" checked={markup} onChange={(e) => setMarkup(e.target.checked)} />
                    Add markup to billed costs
                  </label>
                  {markup ? (
                    <span className="inv-markup-pct">
                      <input
                        aria-label="Markup percent"
                        inputMode="decimal"
                        value={markupPct}
                        onChange={(e) => setMarkupPct(e.target.value)}
                      />
                      %
                    </span>
                  ) : (
                    <span className="est-tax-note">Off: the customer pays exactly what the bill was.</span>
                  )}
                </div>
              )}

              <div className="qr-pair">
                <Field label="Due">
                  <select value={dueInDays} onChange={(e) => setDueInDays(Number(e.target.value))}>
                    {DUE_OPTIONS.map(([days, label]) => (
                      <option key={days} value={days}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="field inv-total">
                  <span className="field-label">Total</span>
                  <strong className="mono">{moneyCents(total)}</strong>
                </div>
              </div>
            </>
          )}
        </div>

        {error && <p className="error-note">{error}</p>}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <button
            type="button"
            className="btn-primary"
            disabled={!setup || lines.length === 0}
            onClick={() => void send("text")}
          >
            {saving ? "Sending…" : "Send invoice by text"}
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={!setup || lines.length === 0}
            title="Issue it without a text — you're handing it over or emailing it yourself"
            onClick={() => void send("marked")}
          >
            Issue without texting
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </fieldset>
    </Modal>
  );
}

/** Find the customer, server-side (79k contacts): the topbar's
 *  debounce-and-discard idiom, same search the New Estimate dialog uses. */
function CustomerSearch({ onPick }: { onPick: (leadId: string) => void }) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<EstimateLeadMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    []
  );

  function handle(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = value.trim();
    if (q.length < 2) {
      setSearching(false);
      setMatches([]);
      return;
    }
    setSearching(true);
    const requestId = ++requestIdRef.current;
    debounceRef.current = setTimeout(() => {
      searchEstimateLeads(q).then((found) => {
        if (requestIdRef.current !== requestId) return;
        setMatches(found);
        setSearching(false);
      });
    }, 300);
  }

  return (
    <div className="field">
      <span className="field-label">Customer</span>
      <input
        autoFocus
        placeholder="Search by name, phone, email or address"
        value={query}
        onChange={(e) => handle(e.target.value)}
      />
      {searching && <span className="est-tax-note">Searching…</span>}
      {matches.length > 0 && (
        <div className="inv-matches">
          {matches.map((m) => (
            <button key={m.id} type="button" className="inv-match" onClick={() => onPick(m.id)}>
              <strong>{m.label}</strong>
              {(m.address || m.email) && <span className="est-tax-note"> {m.address || m.email}</span>}
            </button>
          ))}
        </div>
      )}
      {!searching && query.trim().length >= 2 && matches.length === 0 && (
        <span className="est-tax-note">No customer matches that.</span>
      )}
    </div>
  );
}
