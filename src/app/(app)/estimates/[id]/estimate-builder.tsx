"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SignedOnPaperDialog } from "./signed-on-paper-dialog";
import {
  centsFromInput,
  centsToInput,
  computeEstimateTotals,
  discountPercentLabel,
  estimateMargin,
  formatMarginPct,
  editWillRecallEstimate,
  estimateLocked,
  lineCostCents,
  parseQuantity,
  lineTotalCents,
  marginPct,
  moneyCents,
  signatureProgress,
  type Estimate,
  type EstimateItem,
  type EstimateSigner,
  type EstimateGroup,
  type EstimatePayment,
  type PortalPayment,
} from "@/lib/data/types";
import {
  markEstimateSent,
  saveEstimateDraft,
  sendEstimateToCustomer,
  deleteEstimate,
  voidEstimate,
} from "@/lib/actions/estimates";
import { AddressAutocompleteInput } from "@/components/ui/address-autocomplete-input";
import { PaymentSchedule } from "./payment-schedule";
import { ChangeOrders } from "./change-orders";
import { CompletionCertificate } from "./completion-certificate";
import { JobCosts } from "./job-costs";
import { PhotosPanel } from "./photos-panel";
import { SalesTeamPanel } from "./sales-team";
import { ScopeEditor } from "./scope-editor";
import { SectionsBar } from "./sections-bar";
import { getEstimateGroups } from "@/lib/actions/estimate-groups";
import { GenerateLinesModal, type AcceptedLine } from "./generate-lines-modal";

export type BuilderLead = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
};

// Quantity and price are held as the raw strings the rep typed so a
// half-finished "12." does not get normalised out from under the cursor.
type Row = {
  key: string;
  // The saved row this came from, so a save updates the line rather than
  // replacing it. Null on a line that has never been saved.
  id: string | null;
  groupId: string | null;
  name: string;
  description: string;
  quantity: string;
  unit: string;
  unitCost: string;
  unitPrice: string;
  taxable: boolean;
};

let rowSeq = 0;
function blankRow(): Row {
  rowSeq += 1;
  return {
    key: `row-${rowSeq}`,
    id: null,
    groupId: null,
    name: "",
    description: "",
    quantity: "",
    unit: "",
    unitCost: "",
    unitPrice: "0.00",
    taxable: false,
  };
}

function toRow(item: EstimateItem): Row {
  rowSeq += 1;
  return {
    key: `row-${rowSeq}`,
    id: item.id,
    groupId: item.group_id ?? null,
    name: item.name,
    description: item.description ?? "",
    quantity: String(item.quantity),
    unit: item.unit ?? "",
    // Blank, not "0.00" -- an unknown cost and a genuinely free item are
    // different, and showing 100% margin on the former would be a lie.
    unitCost: item.cost_cents === null ? "" : centsToInput(item.cost_cents),
    unitPrice: centsToInput(item.unit_price_cents),
    taxable: item.taxable,
  };
}

export function EstimateBuilder({
  estimate,
  items,
  signers,
  payments,
  paid,
  lead,
  canEdit,
  canSend = true,
  canManageCosts,
  canManageBills,
  canVoid,
  canDelete,
  customerViews,
}: {
  estimate: Estimate;
  items: EstimateItem[];
  signers: EstimateSigner[];
  payments: EstimatePayment[];
  paid: PortalPayment[];
  lead: BuilderLead | null;
  canEdit: boolean;
  /** The Send Estimates switch. Off = drafts only: Save stays, everything
   *  that would put the document in front of the customer goes. */
  canSend?: boolean;
  /** Recording costs, which Bookkeeping holds without contract editing. */
  canManageCosts: boolean;
  /** Filing an UNPAID vendor bill from the job costs panel. */
  canManageBills: boolean;
  /** Admin only. Voiding cancels work the customer committed to and can
   *  strand money already collected. */
  canVoid: boolean;
  /** Hard delete, drafts only. Same gate as deleting a lead. */
  canDelete: boolean;
  /** When the customer opened this in the portal, newest first. */
  customerViews?: string[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(items.length ? items.map(toRow) : [blankRow()]);
  const [paperDialog, setPaperDialog] = useState(false);
  const [title, setTitle] = useState(estimate.title);
  const [message, setMessage] = useState(estimate.customer_message ?? "");
  const [terms, setTerms] = useState(estimate.terms ?? "");
  const [expiresAt, setExpiresAt] = useState(estimate.expires_at ?? "");
  const [startDate, setStartDate] = useState(estimate.start_date ?? "");
  const [completionDate, setCompletionDate] = useState(estimate.completion_date ?? "");
  const [jobAddress, setJobAddress] = useState(estimate.job_address ?? "");
  // The discount as the rep is editing it. Percent is typed as "5",
  // amount as dollars -- both become the wire format only at save time.
  const [discountOn, setDiscountOn] = useState(!!estimate.discount_type);
  const [discountType, setDiscountType] = useState<"percent" | "amount">(
    estimate.discount_type === "amount" ? "amount" : "percent"
  );
  const [discountInput, setDiscountInput] = useState(
    estimate.discount_type === "percent"
      ? String(estimate.discount_value / 100)
      : estimate.discount_type === "amount"
        ? (estimate.discount_value / 100).toFixed(2)
        : ""
  );
  const [discountLabel, setDiscountLabel] = useState(estimate.discount_label ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  // Which line item has its scope editor open, by row key.
  const [scopeRow, setScopeRow] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  // The section the generator was opened from, so accepted lines land in
  // it. Null means the main button -- lines land ungrouped, as before.
  const [generateInto, setGenerateInto] = useState<string | null>(null);
  const [groups, setGroups] = useState<EstimateGroup[]>([]);
  const [voiding, setVoiding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  // Row being dragged, and the row it is currently hovering over.
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Read-only once the customer has signed, or for a person without
  // write permission. Merely having been sent does not lock it -- the
  // customer asking for a change after reading the quote is the normal
  // course of a sale.
  const signed = estimateLocked(estimate.status, signers);
  const locked = signed || !canEdit;
  // Editing something the customer is currently holding a link to pulls
  // it back to draft, so the rep is told before they start typing rather
  // than after they save.
  const willRecall = !locked && editWillRecallEstimate(estimate.status);
  const sig = signatureProgress(signers);

  // Same computeEstimateTotals the server uses when it saves, so the number
  // on screen and the number stored can't drift apart.
  const parsed = rows.map((r) => ({
    quantity: parseQuantity(r.quantity),
    unit_price_cents: centsFromInput(r.unitPrice),
    taxable: r.taxable,
    // Blank means unknown, which is not the same as zero.
    cost_cents: r.unitCost.trim() === "" ? null : centsFromInput(r.unitCost),
  }));
  // The discount exactly as it will be saved, so the live total below
  // matches the stored one to the cent.
  const discountValue = discountOn
    ? discountType === "percent"
      ? Math.max(0, Math.min(10000, Math.round((Number(discountInput) || 0) * 100)))
      : centsFromInput(discountInput)
    : 0;
  const discountForTotals =
    discountOn && discountValue > 0 ? { type: discountType, value: discountValue } : null;

  const totals = computeEstimateTotals(parsed, estimate.tax_rate_bp, discountForTotals);

  // Section totals from the rows on screen, not from what is saved. A
  // subtotal that lags behind the price typed a moment ago reads as a bug
  // even when the stored figure is right.
  const sectionSubtotals = new Map<string, number>();
  for (const r of rows) {
    if (!r.groupId) continue;
    const cents = lineTotalCents(parseQuantity(r.quantity), centsFromInput(r.unitPrice));
    sectionSubtotals.set(r.groupId, (sectionSubtotals.get(r.groupId) ?? 0) + cents);
  }

  const reloadGroups = useCallback(() => {
    getEstimateGroups(estimate.id).then((res) => setGroups(res.groups ?? []));
  }, [estimate.id]);

  useEffect(() => {
    reloadGroups();
  }, [reloadGroups]);
  const margin = estimateMargin(parsed);
  const costsEntered = parsed.some((p) => p.cost_cents !== null);
  // Named rows only: a blank starter row is not an unpriced line item.
  const unpricedLines = rows.filter(
    (r) => r.name.trim() && centsFromInput(r.unitPrice) === 0
  ).length;

  function patch(key: string, changes: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...changes } : r)));
    setSaved(null);
  }

  /**
   * Reorders a line item. The order on screen is the order the customer
   * reads, and a scope that jumps from finishes back to demolition reads
   * as carelessness on a document someone is about to sign.
   *
   * Dragging the grip is the main way; these arrows are kept alongside it
   * because HTML5 drag-and-drop does not fire on touch at all, so on a
   * phone the grip is dead and the arrows are the only way to reorder.
   *
   * sort_order is written from array position on save, so moving the row
   * here is the whole change.
   */
  function moveRow(key: string, delta: -1 | 1) {
    setRows((prev) => {
      const i = prev.findIndex((r) => r.key === key);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    setSaved(null);
  }

  // Drops the dragged row into the target's position, shifting the rest
  // rather than swapping the two -- dragging item 5 to the top should
  // leave 1-4 in order below it, not fling item 1 down to position 5.
  function dropRowOn(targetKey: string) {
    setRows((prev) => {
      if (!dragKey || dragKey === targetKey) return prev;
      const from = prev.findIndex((r) => r.key === dragKey);
      const to = prev.findIndex((r) => r.key === targetKey);
      if (from < 0 || to < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setDragKey(null);
    setOverKey(null);
    setSaved(null);
  }

  function save(then?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await saveEstimateDraft(
        estimate.id,
        {
          title,
          customer_message: message || null,
          terms: terms || null,
          expires_at: expiresAt || null,
          start_date: startDate || null,
          completion_date: completionDate || null,
          job_address: jobAddress.trim() || null,
        },
        rows.map((r) => ({
          id: r.id,
          group_id: r.groupId,
          name: r.name,
          description: r.description || null,
          quantity: parseQuantity(r.quantity),
          unit: r.unit || null,
          unit_price_cents: centsFromInput(r.unitPrice),
          taxable: r.taxable,
          cost_cents: r.unitCost.trim() === "" ? null : centsFromInput(r.unitCost),
        })),
        discountForTotals
          ? { ...discountForTotals, label: discountLabel.trim() || null }
          : null
      );
      if (res.error) return setError(res.error);

      setSaved(
        res.recalled
          ? `Saved · ${moneyCents(res.totalCents ?? 0)} · recalled from the customer, send again when ready`
          : `Saved · ${moneyCents(res.totalCents ?? 0)}`
      );
      // Outside this transition on purpose. Inside it, "Saving…" stayed
      // up until the whole page had re-fetched -- long after the write
      // was safe -- which read as the save itself being slow. The edits
      // are already on screen; the refresh only reconciles server props.
      setTimeout(() => router.refresh(), 0);
      then?.();
    });
  }

  // Texting the portal link is the normal path; emailing it is the
  // alternative for a customer who prefers or only has email; sending both
  // at once covers a customer who checks whichever they see first; marking
  // it sent without either is the fallback for a customer with no mobile
  // number or email, or one the rep is handing a printout to in person.
  function send(deliver: "text" | "email" | "both" | "manual") {
    setError(null);
    startTransition(async () => {
      const res =
        deliver === "manual"
          ? await markEstimateSent(estimate.id)
          : await sendEstimateToCustomer(estimate.id, deliver);
      if (res.error) return setError(res.error);
      const label = deliver === "email" ? "Emailed" : deliver === "text" ? "Texted" : "Sent";
      const warning = "warning" in res && res.warning ? ` — but ${res.warning}` : "";
      setSaved(
        "sentTo" in res && res.sentTo ? `${label} to ${res.sentTo}${warning}` : "Marked as sent"
      );
      router.refresh();
    });
  }

  const customer = lead
    ? [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim() || "Unnamed lead"
    : "Unknown customer";

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">
            {estimate.doc_number}
            {estimate.version > 1 && <span className="est-version"> v{estimate.version}</span>}
          </h1>
          <p className="module-sub">
            {customer}
            {lead?.address ? ` · ${lead.address}` : ""}
          </p>
        </div>
        <div className="est-header-actions">
          <button className="btn-ghost" onClick={() => router.push("/estimates")}>
            Back
          </button>
          <button
            className="btn-ghost"
            onClick={() => router.push(`/estimates/${estimate.id}/preview`)}
          >
            Preview as Customer
          </button>
          {/* Routes to the document and fires the dialog there: printing
              this page would print the editor's input boxes. */}
          <button
            className="btn-ghost"
            onClick={() => router.push(`/estimates/${estimate.id}/preview?print=1`)}
          >
            Print / PDF
          </button>
          {!locked && (
            <button className="btn-save-red" onClick={() => save()} disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </button>
          )}
          {/* Everything past Save takes the document out of Draft, so it
              is behind the Send Estimates switch. The server refuses
              these too; hiding them just stops a rep clicking into an
              error. */}
          {!locked && canSend && (
            <>
              <button
                className="btn-ghost"
                onClick={() => save(() => send("manual"))}
                disabled={pending}
                title="Mark as sent without texting or emailing -- for a customer with no mobile number or email"
              >
                Mark Sent
              </button>
              <button
                className="btn-ghost"
                onClick={() => save(() => setPaperDialog(true))}
                disabled={pending}
                title="Record a signature that happened with a pen -- nothing is sent to the customer"
              >
                Signed on paper
              </button>
              <button
                className="btn-ghost"
                onClick={() => save(() => send("email"))}
                disabled={pending}
              >
                Save &amp; Email to Customer
              </button>
              <button
                className="btn-save-blue"
                onClick={() => save(() => send("text"))}
                disabled={pending}
              >
                Save &amp; Text to Customer
              </button>
              <button
                className="btn-primary"
                onClick={() => save(() => send("both"))}
                disabled={pending}
                title="Sends both the email and the text -- whichever the customer has on file"
              >
                Save &amp; Send Email + Text
              </button>
            </>
          )}
          {/* Delete only while it is a draft nobody outside the company
              has seen. There was no delete button at all before this --
              deleteEstimate existed but nothing ever called it. */}
          {canDelete && estimate.status === "Draft" && (
            <button
              className="btn-ghost est-void-btn"
              onClick={() => setDeleting(true)}
              disabled={pending}
            >
              Delete
            </button>
          )}
          {/* Void, not delete. Offered only on a document somebody has
              already seen, and only to an Admin -- cancelling signed work
              can strand money the customer has paid. */}
          {canVoid && estimate.status !== "Draft" && estimate.status !== "Void" && (
            <button
              className="btn-ghost est-void-btn"
              onClick={() => setVoiding(true)}
              disabled={pending}
            >
              Void
            </button>
          )}
        </div>
      </div>

      {deleting && (
        <div className="est-locked-banner">
          <p style={{ margin: "0 0 8px" }}>
            <strong>Delete {estimate.doc_number}?</strong>
            {" "}This one is gone for good, along with its lines, photos and payment schedule.
            It is a draft nobody outside the company has seen, so there is nothing to keep a
            record of &mdash; but there is no undo either.
          </p>
          <button
            className="btn-primary small"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await deleteEstimate(estimate.id);
                if (res.error) {
                  setDeleting(false);
                  return setError(res.error);
                }
                router.push("/estimates");
              })
            }
          >
            {pending ? "Deleting…" : "Delete permanently"}
          </button>
          <button
            className="btn-ghost small"
            onClick={() => setDeleting(false)}
            disabled={pending}
          >
            Cancel
          </button>
        </div>
      )}

      {voiding && (
        <div className="est-locked-banner">
          <p style={{ margin: "0 0 8px" }}>
            {/* Explicit space: JSX drops the one between an element and the
                text after it, which ran this into "CO2?The document". */}
            <strong>Void {estimate.doc_number}?</strong>
            {" "}The document stays on the customer&rsquo;s record marked as cancelled, and
            stops counting towards any total. Phases you have not yet billed are cancelled;
            anything already billed stays, and no payment is reversed &mdash; refunds are still
            yours to send by card or cheque.
          </p>
          <input
            className="est-item-name"
            placeholder="Why is this being cancelled?"
            value={voidReason}
            autoFocus
            disabled={pending}
            onChange={(e) => setVoidReason(e.target.value)}
          />
          <button
            className="btn-primary small"
            disabled={pending || !voidReason.trim()}
            onClick={() =>
              startTransition(async () => {
                const res = await voidEstimate(estimate.id, voidReason);
                if (res.error) return setError(res.error);
                setVoiding(false);
                setSaved(
                  res.collectedCents
                    ? `Voided · ${moneyCents(res.collectedCents)} was collected on this document and has not been refunded`
                    : "Voided"
                );
                router.refresh();
              })
            }
          >
            {pending ? "Voiding…" : "Void this document"}
          </button>
          <button
            className="btn-ghost small"
            onClick={() => setVoiding(false)}
            disabled={pending}
          >
            Cancel
          </button>
        </div>
      )}

      {!locked && !canSend && (
        <div className="est-locked-banner">
          Drafts only: you can build and save this estimate, and preview or print it, but
          sending it to the customer is done by the office. Ask an Office or Admin user to
          send it — or to turn on Send Estimates for you in Users &amp; Roles.
        </div>
      )}

      {locked && (
        <div className="est-locked-banner">
          {estimate.status === "Void" ? (
            <>
              Voided
              {estimate.voided_at
                ? ` on ${new Date(estimate.voided_at).toLocaleDateString("en-US")}`
                : ""}
              {estimate.void_reason ? ` — ${estimate.void_reason}` : ""}. The record is kept
              deliberately; it no longer counts towards any total.
            </>
          ) : !canEdit ? (
            "You can view estimates but not change them. Ask an Office or Admin user for Create Estimates access."
          ) : (
            <>
              The customer signed this on{" "}
              {estimate.signed_at
                ? new Date(estimate.signed_at).toLocaleDateString("en-US")
                : "—"}
              , so it is now a contract and cannot be edited. Create a new version to change it.
            </>
          )}
          {sig.total > 0 && (
            <>
              {" "}
              Signatures: {sig.signed} of {sig.total}
              {/* The count is history and worth keeping, but "Pending"
                  states an outstanding obligation. On a cancelled or
                  declined document there is none, and naming the customer
                  there had this banner contradict its own first line. */}
              {sig.pending.length > 0 &&
                estimate.status !== "Void" &&
                estimate.status !== "Declined" &&
                ` · Pending: ${sig.pending.join(", ")}`}
            </>
          )}
        </div>
      )}

      {/* The customer's attention, dated. Five opens in two days is a
          customer deciding; none since Sent is a phone call waiting to
          happen. Portal opens only -- staff previews never count. */}
      {(customerViews?.length ?? 0) > 0 && (
        <details className="est-views-trail">
          <summary>
            👁 Customer viewed {customerViews!.length}
            {customerViews!.length === 1 ? " time" : " times"} · last{" "}
            {new Date(customerViews![0]).toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </summary>
          <ul className="lead-trail-list">
            {customerViews!.map((v, i) => (
              <li key={i}>
                {new Date(v).toLocaleString("en-US", {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="est-meta-grid">
        <label className="field">
          <span className="field-label">Title</span>
          <input
            className="est-title-input"
            value={title}
            disabled={locked}
            onChange={(e) => {
              setTitle(e.target.value);
              setSaved(null);
            }}
          />
        </label>
        {/* Blank means the client's own address, which is the common
            case; filled means an investor's rental, a second property.
            The document then names both, because a contract is supposed
            to say where the work will be done. */}
        <label className="field">
          <span className="field-label">Job location</span>
          <AddressAutocompleteInput
            value={jobAddress}
            disabled={locked}
            placeholder={lead?.address ? `Same as client — ${lead.address}` : "Same as client address"}
            onChange={(address) => {
              setJobAddress(address);
              setSaved(null);
            }}
          />
        </label>
        <label className="field">
          <span className="field-label">Expires</span>
          <input
            className="est-title-input"
            type="date"
            value={expiresAt}
            disabled={locked}
            onChange={(e) => {
              setExpiresAt(e.target.value);
              setSaved(null);
            }}
          />
        </label>
        {/* California requires a home improvement contract to state
            approximate start and completion dates, and the contract
            merges these in. Approximate is the standard the law sets --
            hence the wording, and hence neither being required: a date
            guessed to fill a box reads as a commitment. */}
        <label className="field">
          <span className="field-label">Start date (approx.)</span>
          <input
            className="est-title-input"
            type="date"
            value={startDate}
            disabled={locked}
            onChange={(e) => {
              setStartDate(e.target.value);
              setSaved(null);
            }}
          />
        </label>
        <label className="field">
          <span className="field-label">Completion (approx.)</span>
          <input
            className="est-title-input"
            type="date"
            value={completionDate}
            disabled={locked}
            onChange={(e) => {
              setCompletionDate(e.target.value);
              setSaved(null);
            }}
          />
        </label>
      </div>

      <div className="est-items-wrap">
        <table className="data-table est-items">
        <thead>
          <tr>
            <th className="est-grip-col"></th>
            <th>Item</th>
            <th className="right">Qty</th>
            <th>Unit</th>
            <th className="right est-internal-col">Cost</th>
            <th className="right">Price</th>
            <th className="center">Tax</th>
            <th className="right">Total</th>
            <th className="right est-internal-col">Margin</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.key}
              className={
                (dragKey === r.key ? "est-dragging" : "") +
                (overKey === r.key && dragKey && dragKey !== r.key ? " est-drop-target" : "")
              }
              onDragOver={(e) => {
                if (!dragKey || dragKey === r.key) return;
                // Without preventDefault the browser refuses the drop.
                e.preventDefault();
                if (overKey !== r.key) setOverKey(r.key);
              }}
              onDrop={(e) => {
                e.preventDefault();
                dropRowOn(r.key);
              }}
            >
              <td className="est-grip-col">
                {!locked && rows.length > 1 && (
                  <span
                    className="est-grip"
                    draggable
                    onDragStart={(e) => {
                      setDragKey(r.key);
                      e.dataTransfer.effectAllowed = "move";
                      // Firefox will not start a drag without payload.
                      e.dataTransfer.setData("text/plain", r.key);
                    }}
                    onDragEnd={() => {
                      setDragKey(null);
                      setOverKey(null);
                    }}
                    title="Drag to reorder"
                    aria-hidden="true"
                  >
                    ⠿
                  </span>
                )}
              </td>
              <td>
                <input
                  className="est-item-name"
                  placeholder="Description of work"
                  value={r.name}
                  disabled={locked}
                  onChange={(e) => patch(r.key, { name: e.target.value })}
                />
                <div className="est-desc-wrap">
                  {/* A textarea, not an input: a real scope of work runs to
                      several lines and a single-line field silently hides
                      everything past the first. Grows with its content up
                      to a sane height, then scrolls. */}
                  <textarea
                    className="est-item-desc"
                    placeholder="Scope detail (optional, shown to customer)"
                    value={r.description}
                    disabled={locked}
                    rows={Math.min(6, Math.max(1, r.description.split("\n").length))}
                    onChange={(e) => patch(r.key, { description: e.target.value })}
                  />
                  <button
                    type="button"
                    className="btn-ghost est-desc-expand"
                    onClick={() => setScopeRow(r.key)}
                    title={locked ? "View full scope" : "Expand to write the full scope"}
                  >
                    ⤢
                  </button>
                </div>
              </td>
              {/* data-label feeds the phone layout, where the header row is
                  hidden and each cell has to name itself. */}
              <td className="right" data-label="Qty">
                <input
                  className={
                    "est-item-qty" +
                    // An explicit 0 against a real price zeroes the line.
                    // That is legal but almost always a slip, so it is
                    // flagged rather than left to be noticed in the total.
                    (r.quantity.trim() === "0" && centsFromInput(r.unitPrice) > 0
                      ? " est-qty-zero"
                      : "")
                  }
                  inputMode="decimal"
                  placeholder="1"
                  title="Leave blank for a lump sum — blank counts as 1"
                  value={r.quantity}
                  disabled={locked}
                  onChange={(e) => patch(r.key, { quantity: e.target.value })}
                />
              </td>
              <td data-label="Unit">
                <input
                  className="est-item-unit"
                  placeholder="ea"
                  value={r.unit}
                  disabled={locked}
                  onChange={(e) => patch(r.key, { unit: e.target.value })}
                />
                {/* Only once sections exist. On a small job the column
                    would be a permanently empty dropdown asking a
                    question nobody has. */}
                {groups.length > 0 && (
                  <select
                    className="est-item-unit"
                    value={r.groupId ?? ""}
                    disabled={locked}
                    onChange={(e) => patch(r.key, { groupId: e.target.value || null })}
                  >
                    <option value="">No section</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                )}
              </td>
              <td className="right est-internal-col" data-label="Your cost">
                <input
                  className="est-item-price est-item-cost"
                  inputMode="decimal"
                  placeholder="—"
                  value={r.unitCost}
                  disabled={locked}
                  onChange={(e) => patch(r.key, { unitCost: e.target.value })}
                  aria-label="Your cost (internal)"
                />
              </td>
              <td className="right" data-label="Price">
                <input
                  className="est-item-price"
                  inputMode="decimal"
                  value={r.unitPrice}
                  disabled={locked}
                  onChange={(e) => patch(r.key, { unitPrice: e.target.value })}
                />
              </td>
              <td className="center" data-label="Taxable">
                <input
                  type="checkbox"
                  checked={r.taxable}
                  disabled={locked}
                  onChange={(e) => patch(r.key, { taxable: e.target.checked })}
                  aria-label="Taxable"
                />
              </td>
              <td className="right mono" data-label="Line total">
                {moneyCents(lineTotalCents(parseQuantity(r.quantity), centsFromInput(r.unitPrice)))}
              </td>
              <td className="right mono est-internal-col" data-label="Margin">
                {(() => {
                  if (r.unitCost.trim() === "") return <span className="est-margin-none">—</span>;
                  const qty = parseQuantity(r.quantity);
                  const revenue = lineTotalCents(qty, centsFromInput(r.unitPrice));
                  const cost = lineCostCents(qty, centsFromInput(r.unitCost));
                  const pct = marginPct(revenue, cost);
                  // Selling below cost is the thing this column exists to
                  // catch, so it has to be impossible to skim past.
                  const cls =
                    pct === null ? "" : pct < 0 ? " est-margin-loss" : pct < 20 ? " est-margin-thin" : "";
                  return (
                    <span className={"est-margin" + cls}>
                      {formatMarginPct(pct)}
                      <span className="est-margin-abs">{moneyCents(revenue - cost)}</span>
                    </span>
                  );
                })()}
              </td>
              <td className="est-row-tools">
                {!locked && rows.length > 1 && (
                  <span className="est-move-group">
                    <button
                      className="btn-ghost est-move"
                      onClick={() => moveRow(r.key, -1)}
                      disabled={rows[0].key === r.key}
                      aria-label="Move this item up"
                      title="Move up"
                    >
                      ▲
                    </button>
                    <button
                      className="btn-ghost est-move"
                      onClick={() => moveRow(r.key, 1)}
                      disabled={rows[rows.length - 1].key === r.key}
                      aria-label="Move this item down"
                      title="Move down"
                    >
                      ▼
                    </button>
                  </span>
                )}
                {!locked && rows.length > 1 && (
                  <button
                    className="btn-ghost est-row-remove"
                    onClick={() => {
                      setRows((prev) => prev.filter((x) => x.key !== r.key));
                      setSaved(null);
                    }}
                    aria-label="Remove line"
                  >
                    ×
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>

      {!locked && (
        <div className="est-add-row-group">
          <button className="btn-ghost" onClick={() => setRows((p) => [...p, blankRow()])}>
            + Add line
          </button>
          <button className="btn-ghost" onClick={() => setGenerating(true)}>
            ✨ Generate priced estimate
          </button>
        </div>
      )}

      <SectionsBar
        estimateId={estimate.id}
        groups={groups}
        subtotals={sectionSubtotals}
        locked={locked}
        onChanged={reloadGroups}
        onGenerate={(groupId) => {
          setGenerateInto(groupId);
          setGenerating(true);
        }}
      />

      <div className="est-totals">
        <div className="est-total-row">
          <span>Subtotal</span>
          <span className="mono">{moneyCents(totals.subtotalCents)}</span>
        </div>
        {!locked && !discountOn && (
          <div className="est-total-row">
            <button
              type="button"
              className="btn-ghost small"
              onClick={() => setDiscountOn(true)}
            >
              + Add discount
            </button>
            <span />
          </div>
        )}
        {discountOn && (
          <>
            <div className="est-total-row est-discount-row">
              <span>
                {discountLabel.trim() || "Discount"}
                {discountType === "percent" && discountValue > 0 && (
                  <span className="est-tax-rate"> ({discountPercentLabel(discountValue)})</span>
                )}
              </span>
              <span className="mono">−{moneyCents(totals.discountCents)}</span>
            </div>
            {!locked && (
              <div className="est-discount-editor">
                <select
                  value={discountType}
                  onChange={(e) => setDiscountType(e.target.value as "percent" | "amount")}
                >
                  <option value="percent">%</option>
                  <option value="amount">$</option>
                </select>
                <input
                  value={discountInput}
                  onChange={(e) => setDiscountInput(e.target.value)}
                  placeholder={discountType === "percent" ? "5" : "2500"}
                  inputMode="decimal"
                />
                <input
                  className="est-discount-label"
                  value={discountLabel}
                  onChange={(e) => setDiscountLabel(e.target.value)}
                  placeholder="Name it — e.g. Signing-today discount"
                />
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => {
                    setDiscountOn(false);
                    setDiscountInput("");
                    setDiscountLabel("");
                  }}
                  aria-label="Remove discount"
                >
                  ✕
                </button>
              </div>
            )}
          </>
        )}
        <div className="est-total-row">
          <span>
            Tax
            {estimate.tax_rate_bp > 0 && (
              <span className="est-tax-rate"> ({(estimate.tax_rate_bp / 100).toFixed(2)}%)</span>
            )}
          </span>
          <span className="mono">{moneyCents(totals.taxCents)}</span>
        </div>
        <div className="est-total-row est-total-grand">
          <span>Total</span>
          <span className="mono">{moneyCents(totals.totalCents)}</span>
        </div>
        {estimate.tax_rate_bp === 0 && (
          <p className="est-tax-note">
            No tax rate set. Add one in Admin Settings to tax the lines marked above.
          </p>
        )}
        {/* The customer sees a blank rather than $0.00, which reads as
            "included". On a signed contract that is a commitment to do
            the work at no charge, so the rep is told the count here
            rather than discovering it in a dispute. */}
        {unpricedLines > 0 && (
          <p className="est-unpriced-note">
            {unpricedLines} line{unpricedLines === 1 ? "" : "s"} ha
            {unpricedLines === 1 ? "s" : "ve"} no price. The customer sees a blank amount, which
            reads as included in the work above — on a signed contract that commits you to it.
          </p>
        )}
      </div>

      {costsEntered && (
        <div className="est-margin-panel">
          <div className="est-margin-head">
            Your margin
            <span className="est-internal-flag">Internal only — never shown to the customer</span>
          </div>
          <div className="est-margin-figures">
            <div>
              <span className="est-margin-label">Cost</span>
              <span className="mono">{moneyCents(margin.costCents)}</span>
            </div>
            <div>
              <span className="est-margin-label">Gross profit</span>
              <span className="mono">{moneyCents(margin.profitCents)}</span>
            </div>
            <div>
              <span className="est-margin-label">Margin</span>
              <span
                className={
                  "mono est-margin" +
                  (margin.pct === null
                    ? ""
                    : margin.pct < 0
                      ? " est-margin-loss"
                      : margin.pct < 20
                        ? " est-margin-thin"
                        : "")
                }
              >
                {formatMarginPct(margin.pct)}
              </span>
            </div>
          </div>
          {margin.pct !== null && margin.pct < 0 && (
            <p className="est-margin-warn">
              This job is priced below cost — you would lose {moneyCents(-margin.profitCents)}.
            </p>
          )}
          <p className="est-tax-note">
            Margin is a share of the price, not a markup on cost. Costs left blank are excluded
            rather than counted as zero.
          </p>
        </div>
      )}

      {willRecall && (
        <div className="est-recall-banner">
          <strong>This is out with the customer.</strong> You can still edit it — saving pulls it
          back to draft so they can&apos;t sign a version they never read, and their existing link
          stops working. Send it again when you&apos;re done.
        </div>
      )}

      {/* Above the payment schedule: the photos argue for the price, so
          the customer should meet them before the number. */}
      <PhotosPanel
        estimateId={estimate.id}
        leadId={estimate.lead_id}
        items={items}
        locked={locked}
        kind={estimate.kind ?? "contract"}
      />

      <PaymentSchedule
        estimateId={estimate.id}
        totalCents={totals.totalCents}
        depositPercentBp={estimate.deposit_percent_bp}
        depositCapCents={estimate.deposit_cap_cents}
        payments={payments}
        paid={paid}
        locked={locked}
        onChanged={() => router.refresh()}
      />

      {/* Costs are worth recording from the moment a job is real, which is
          when it is signed -- not when it completes. A margin that only
          appears at the end is a post-mortem, not a warning. Kept off
          change orders and completion certificates: those share the job's
          costs rather than having their own. */}
      {estimate.status === "Signed" && estimate.kind === "contract" && (
        <JobCosts
          leadId={estimate.lead_id}
          jobLabel={
            (lead
              ? [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim()
              : "") || estimate.title || estimate.doc_number
          }
          payments={payments}
          totalCents={estimate.total_cents}
          depositPercentBp={estimate.deposit_percent_bp}
          depositCapCents={estimate.deposit_cap_cents}
          canEdit={canManageCosts}
          canBills={canManageBills}
        />
      )}

            {/* Commission is settled on the signed contract, so it lives here
          rather than on a proposal nobody has agreed to. */}
      {estimate.status === "Signed" && estimate.kind === "contract" && (
        <SalesTeamPanel
          estimateId={estimate.id}
          leadId={estimate.lead_id}
          contractCents={estimate.total_cents}
          canEdit={canVoid}
        />
      )}

      {/* Only on a signed contract, and never on a change order itself --
          a change order to a change order is a chain nobody can read. */}
      {estimate.status === "Signed" && estimate.kind === "contract" && (
        <>
          <ChangeOrders
            estimateId={estimate.id}
            contractTotalCents={estimate.total_cents}
            canEdit={canEdit}
          />
          <CompletionCertificate contractId={estimate.id} canEdit={canEdit} />
        </>
      )}

      <div className="est-meta-grid">
        <label className="field">
          <span className="field-label">Message to customer</span>
          <textarea
            className="est-textarea"
            rows={3}
            value={message}
            disabled={locked}
            onChange={(e) => {
              setMessage(e.target.value);
              setSaved(null);
            }}
          />
        </label>
        <label className="field">
          <span className="field-label">Terms</span>
          <textarea
            className="est-textarea"
            rows={3}
            value={terms}
            disabled={locked}
            onChange={(e) => {
              setTerms(e.target.value);
              setSaved(null);
            }}
          />
        </label>
      </div>

      {error && <p className="error-note">{error}</p>}
      {saved && <p className="hint-note">{saved}</p>}

      {generating && (
        <GenerateLinesModal
          sectionName={groups.find((g) => g.id === generateInto)?.name ?? null}
          onClose={() => {
            setGenerating(false);
            setGenerateInto(null);
          }}
          onAccept={(accepted: AcceptedLine[]) => {
            setRows((prev) => {
              // A single untouched blank starter row is replaced rather
              // than left above the generated lines.
              const base =
                prev.length === 1 && !prev[0].name.trim() && !prev[0].unitPrice.replace(/[0.]/g, "")
                  ? []
                  : prev;
              return [
                ...base,
                ...accepted.map((a) => ({
                  ...blankRow(),
                  // Straight into the section the generator was opened
                  // from. Landing ungrouped meant assigning twenty
                  // dropdowns by hand, which in practice meant not using
                  // sections at all.
                  groupId: generateInto,
                  name: a.name,
                  description: a.description,
                  quantity: a.quantity,
                  unit: a.unit,
                  unitPrice: a.unitPrice,
                })),
              ];
            });
            setSaved(null);
            setGenerating(false);
            setGenerateInto(null);
          }}
        />
      )}

      {scopeRow !== null && (
        <ScopeEditor
          title={rows.find((r) => r.key === scopeRow)?.name ?? ""}
          initial={rows.find((r) => r.key === scopeRow)?.description ?? ""}
          readOnly={locked}
          estimateId={estimate.id}
          onClose={() => setScopeRow(null)}
          onSave={(text) => {
            patch(scopeRow, { description: text });
            setScopeRow(null);
          }}
        />
      )}
      {paperDialog && (
        <SignedOnPaperDialog
          estimateId={estimate.id}
          leadId={estimate.lead_id}
          docLabel={estimate.kind === "change_order" ? "change order" : "contract"}
          onClose={() => setPaperDialog(false)}
        />
      )}
    </div>
  );
}
