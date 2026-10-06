"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Field } from "@/components/ui/field";
import { centsFromInput, centsToInput, lineTotalCents, moneyCents, type Estimate, type EstimateItem } from "@/lib/data/types";
import {
  INVOICE_TERMS_DAYS,
  invoiceEditError,
  invoiceEditTotals,
  paymentTermsLabel,
  type InvoiceEditLine,
} from "@/lib/data/invoices";
import {
  deleteInvoiceDraft,
  getInvoiceSetup,
  issueInvoice,
  saveInvoiceDraft,
  type InvoiceCostOption,
} from "@/lib/actions/invoices";
import type { InvoiceLineCost } from "./invoice-view";
import { issuedNote, stashInvoiceNote } from "./invoice-note";
import { SendChannelSelect, defaultBillChannel, sendLabel } from "@/components/invoices/send-channel-select";
import type { BillChannel } from "@/lib/bill-email";

type Line = {
  key: number;
  name: string;
  description: string;
  quantity: string;
  unitPrice: string;
  taxable: boolean;
  sourceExpenseId: string | null;
  showReceipt: boolean;
  /** What the cost it bills back says, for the chip. */
  costNote: string | null;
};

let nextKey = 1;

const blankLine = (): Line => ({
  key: nextKey++,
  name: "",
  description: "",
  quantity: "1",
  unitPrice: "",
  taxable: false,
  sourceExpenseId: null,
  showReceipt: false,
  costNote: null,
});

const fmtDay = (iso: string) =>
  new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

const toEdit = (l: Line): InvoiceEditLine => ({
  name: l.name,
  description: l.description,
  quantity: l.quantity.trim() === "" ? Number.NaN : Number(l.quantity),
  unitPriceCents: centsFromInput(l.unitPrice),
  taxable: l.taxable,
  sourceExpenseId: l.sourceExpenseId,
  showReceipt: l.showReceipt,
});

/** A percent as typed ("7.25") in basis points (725); junk is no tax. */
const bpFromPercent = (raw: string) => {
  const n = Number(raw.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

/**
 * A draft invoice (DECISIONS #149): everything on it can still change --
 * the lines and their quantities, which are taxed and at what rate, when
 * it's due, and a note for the customer. Sending it issues it, and from
 * then on it's a record: a mistake is cancelled and re-issued.
 */
export function InvoiceDraftEditor({
  invoice,
  items,
  customer,
  parent,
  costs,
  canEdit,
}: {
  invoice: Estimate;
  items: (EstimateItem & { source_expense_id?: string | null; show_source_receipt?: boolean | null })[];
  customer: { id: string; name: string; phone: string | null; email: string | null };
  parent: { id: string; doc_number: string } | null;
  costs: Record<string, InvoiceLineCost>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(invoice.title ?? "");
  const [lines, setLines] = useState<Line[]>(() =>
    items.length
      ? items.map((i) => {
          const cost = i.source_expense_id ? costs[i.source_expense_id] : undefined;
          return {
            key: nextKey++,
            name: i.name,
            description: i.description ?? "",
            quantity: String(i.quantity),
            unitPrice: centsToInput(i.unit_price_cents),
            taxable: i.taxable,
            sourceExpenseId: i.source_expense_id ?? null,
            showReceipt: !!i.source_expense_id && i.show_source_receipt !== false,
            costNote: cost ? `From bill · ${moneyCents(cost.amount_cents)} paid ${fmtDay(cost.spent_on)}` : null,
          };
        })
      : [blankLine()]
  );
  const [taxRate, setTaxRate] = useState(String((invoice.tax_rate_bp ?? 0) / 100));
  const [termsDays, setTermsDays] = useState<number>(invoice.payment_terms_days ?? 0);
  const [note, setNote] = useState(invoice.customer_message ?? "");
  const [billable, setBillable] = useState<InvoiceCostOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [channel, setChannel] = useState<BillChannel>(() => defaultBillChannel(customer));
  const [pending, startTransition] = useTransition();

  // The job's paid costs that aren't on another invoice, to bill back.
  useEffect(() => {
    if (!canEdit) return;
    let live = true;
    getInvoiceSetup(customer.id).then((res) => {
      if (live && res.setup) setBillable(res.setup.costs.filter((c) => !c.billedOn || c.billedOn === invoice.doc_number));
    });
    return () => {
      live = false;
    };
  }, [canEdit, customer.id, invoice.doc_number]);

  const edits = lines.map(toEdit);
  const taxRateBp = bpFromPercent(taxRate);
  const totals = invoiceEditTotals(
    edits.map((l) => ({ ...l, quantity: Number.isFinite(l.quantity) ? l.quantity : 0 })),
    taxRateBp
  );
  const anyTaxable = lines.some((l) => l.taxable);
  const onInvoice = new Set(lines.map((l) => l.sourceExpenseId).filter(Boolean));
  const costChoices = billable.filter((c) => !onInvoice.has(c.id));

  const patch = (key: number, p: Partial<Line>) => {
    setSaved(null);
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));
  };

  async function save(): Promise<boolean> {
    const problem = invoiceEditError(edits);
    if (problem) {
      setError(problem);
      return false;
    }
    const res = await saveInvoiceDraft(invoice.id, { title, lines: edits, taxRateBp, termsDays, note });
    if (res.error) {
      setError(res.error);
      return false;
    }
    return true;
  }

  function act(kind: "save" | BillChannel | "marked") {
    setError(null);
    setSaved(null);
    startTransition(async () => {
      if (!(await save())) return;
      if (kind === "save") {
        setSaved("Draft saved.");
        router.refresh();
        return;
      }
      const res = await issueInvoice(invoice.id, kind);
      if (!res.issued) return setError(res.error ?? "Couldn't send it.");
      // Issued: this page gives way to the issued invoice, which says
      // what happened -- including a text that didn't go out.
      stashInvoiceNote(invoice.id, res.error ?? res.warning ?? issuedNote(invoice.doc_number, res.sentTo));
      router.refresh();
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const res = await deleteInvoiceDraft(invoice.id);
      if (res.error) return setError(res.error);
      router.push("/invoices?status=draft");
    });
  }

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">
            Invoice {invoice.doc_number} <span className="est-badge est-badge-draft">Draft</span>
          </h1>
          <p className="module-sub">
            <Link href={`/contacts?openLead=${customer.id}&from=/estimates/${invoice.id}`}>{customer.name}</Link>
            {parent && (
              <>
                {" · for contract "}
                <Link href={`/estimates/${parent.id}`}>{parent.doc_number}</Link>
              </>
            )}
            {" · not sent yet — the customer can't see it"}
          </p>
        </div>
        <div className="est-header-actions">
          <button className="btn-ghost" onClick={() => router.back()}>
            Back
          </button>
          <Link className="btn-ghost" href={`/estimates/${invoice.id}/preview`}>
            Preview as Customer
          </Link>
        </div>
      </div>

      {!canEdit && <p className="hint-note">Only someone who can create invoices can change or send this draft.</p>}

      <fieldset disabled={!canEdit || pending} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="qr-form">
          <Field label="What it's for">
            <input placeholder="e.g. Permit fees" value={title} onChange={(e) => { setSaved(null); setTitle(e.target.value); }} />
          </Field>

          <div className="inv-lines">
            {lines.map((l) => {
              const e = toEdit(l);
              const lineTotal = Number.isFinite(e.quantity) ? lineTotalCents(e.quantity, e.unitPriceCents) : 0;
              return (
                <div key={l.key} className="inv-line inv-edit-line">
                  <div className="inv-line-main">
                    <input
                      aria-label="Description"
                      placeholder="Description, e.g. Dumpster rental"
                      value={l.name}
                      onChange={(ev) => patch(l.key, { name: ev.target.value })}
                    />
                    <input
                      aria-label="Detail"
                      className="inv-line-detail"
                      placeholder="Detail (optional)"
                      value={l.description}
                      onChange={(ev) => patch(l.key, { description: ev.target.value })}
                    />
                    {l.sourceExpenseId && (
                      <div className="inv-line-src">
                        {l.costNote && <span className="inv-src-chip">{l.costNote}</span>}
                        <label className="inv-check">
                          <input
                            type="checkbox"
                            checked={l.showReceipt}
                            onChange={(ev) => patch(l.key, { showReceipt: ev.target.checked })}
                          />
                          Show the receipt to the customer
                        </label>
                      </div>
                    )}
                  </div>
                  <div className="inv-edit-money">
                    <label className="inv-edit-qty">
                      <span className="est-tax-note">Qty</span>
                      <input
                        aria-label="Quantity"
                        inputMode="decimal"
                        value={l.quantity}
                        onChange={(ev) => patch(l.key, { quantity: ev.target.value })}
                      />
                    </label>
                    <label className="inv-edit-price">
                      <span className="est-tax-note">Price</span>
                      <input
                        aria-label="Unit price"
                        inputMode="decimal"
                        placeholder="0.00"
                        value={l.unitPrice}
                        onChange={(ev) => patch(l.key, { unitPrice: ev.target.value })}
                      />
                    </label>
                    <label className="inv-check">
                      <input type="checkbox" checked={l.taxable} onChange={(ev) => patch(l.key, { taxable: ev.target.checked })} />
                      Taxable
                    </label>
                    <span className="mono inv-edit-total">{moneyCents(lineTotal)}</span>
                    <button
                      type="button"
                      className="btn-ghost est-row-remove"
                      aria-label="Remove line"
                      onClick={() => {
                        setSaved(null);
                        setLines((ls) => ls.filter((x) => x.key !== l.key));
                      }}
                    >
                      ×
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="inv-add-row">
            <button type="button" className="btn-ghost small" onClick={() => setLines((ls) => [...ls, blankLine()])}>
              + Add line
            </button>
            {costChoices.length > 0 && (
              <select
                aria-label="Bill a job cost"
                value=""
                onChange={(ev) => {
                  const cost = costChoices.find((c) => c.id === ev.target.value);
                  if (!cost) return;
                  setSaved(null);
                  setLines((ls) => [
                    ...ls.filter((x) => x.sourceExpenseId || x.name || x.unitPrice),
                    {
                      ...blankLine(),
                      name: cost.description?.trim() || cost.category?.trim() || "Reimbursable cost",
                      description: cost.vendorName ? `Paid to ${cost.vendorName}` : "",
                      unitPrice: centsToInput(cost.amountCents),
                      sourceExpenseId: cost.id,
                      showReceipt: cost.hasReceipt,
                      costNote: `From bill · ${moneyCents(cost.amountCents)} paid ${fmtDay(cost.spentOn)}`,
                    },
                  ]);
                }}
              >
                <option value="">+ Bill a job cost…</option>
                {costChoices.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label} — {moneyCents(c.amountCents)}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="qr-pair">
            <Field label="Tax rate (%)">
              <input inputMode="decimal" value={taxRate} onChange={(e) => { setSaved(null); setTaxRate(e.target.value); }} />
            </Field>
            <Field label="Payment terms">
              <select value={termsDays} onChange={(e) => { setSaved(null); setTermsDays(Number(e.target.value)); }}>
                {INVOICE_TERMS_DAYS.map((d) => (
                  <option key={d} value={d}>
                    {paymentTermsLabel(d)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Note to the customer (optional)">
            <textarea
              rows={2}
              placeholder="e.g. Thank you for your business."
              value={note}
              onChange={(e) => { setSaved(null); setNote(e.target.value); }}
            />
          </Field>

          <div className="inv-edit-totals">
            <div>
              <span>Subtotal</span>
              <span className="mono">{moneyCents(totals.subtotalCents)}</span>
            </div>
            {(anyTaxable || totals.taxCents > 0) && (
              <div>
                <span>Sales tax{taxRateBp > 0 ? ` (${taxRateBp / 100}%)` : ""}</span>
                <span className="mono">{moneyCents(totals.taxCents)}</span>
              </div>
            )}
            <div className="inv-edit-grand">
              <span>Total</span>
              <span className="mono">{moneyCents(totals.totalCents)}</span>
            </div>
            <p className="est-tax-note">
              {termsDays === 0 ? "Due the day it's sent." : `Due ${termsDays} days after it's sent.`}
            </p>
          </div>
        </div>

        {error && <p className="error-note">{error}</p>}
        {saved && <p className="hint-note">{saved}</p>}

        <div className="inv-actions">
          <SendChannelSelect value={channel} onChange={setChannel} />
          <button type="button" className="btn-primary" onClick={() => act(channel)}>
            {pending ? "Working…" : sendLabel(channel)}
          </button>
          <button
            type="button"
            className="btn-ghost"
            title="Issue it without sending anything — you're handing it over yourself"
            onClick={() => act("marked")}
          >
            Issue without sending
          </button>
          <button type="button" className="btn-ghost" onClick={() => act("save")}>
            Save draft
          </button>
          {!confirmDelete ? (
            <button type="button" className="btn-ghost est-void-btn" onClick={() => setConfirmDelete(true)}>
              Delete draft
            </button>
          ) : (
            <>
              <button type="button" className="btn-ghost est-void-btn" onClick={remove}>
                Yes, delete {invoice.doc_number}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setConfirmDelete(false)}>
                Keep it
              </button>
            </>
          )}
        </div>
        {(!customer.phone || !customer.email) && (
          <p className="est-tax-note">
            {customer.name} has no {!customer.phone && !customer.email ? "phone number or email address" : !customer.phone ? "phone number" : "email address"} on file
            {customer.phone || customer.email ? `, so it can only go by ${customer.phone ? "text" : "email"}.` : ", so it can't be sent. Issue it without sending instead."}
          </p>
        )}
      </fieldset>
    </div>
  );
}
