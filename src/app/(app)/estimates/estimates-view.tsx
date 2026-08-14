"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  estimateExpired,
  moneyCents,
  isSellableKind,
  signatureProgress,
  type Estimate,
  type EstimateSigner,
  type EstimateStatus,
} from "@/lib/data/types";
import { NewEstimateDialog } from "./new-estimate-dialog";
import { FilterSelect } from "@/components/filter-select";

export type EstimateLead = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  address: string | null;
  stage: string;
};

export type EstimateRep = { id: string; name: string | null; email: string | null };

// The funnel from the reference product: a draft nobody has seen, a
// proposal awaiting signature, and a signed contract are three different
// things to a contractor even though they are one row in the database.
// Change orders are a fifth card rather than folded into the first four.
// They are signed estimates too, so left alone a $1,200 extra would land
// in Contracts and turn "4 signed" into "5 signed" -- counting one job
// twice. Kept visible rather than merely filtered out, because an unsent
// change order is extra work nobody has agreed to yet, and hiding it is
// how it gets built anyway.
type Bucket = "drafts" | "sent" | "signed" | "declined" | "void" | "changes";

const BUCKETS: { key: Bucket; label: string; hint: string; statuses: EstimateStatus[] }[] = [
  { key: "drafts", label: "Drafts", hint: "not sent yet", statuses: ["Draft"] },
  { key: "sent", label: "Proposals", hint: "awaiting signature", statuses: ["Sent", "Viewed"] },
  { key: "signed", label: "Contracts", hint: "signed", statuses: ["Signed"] },
  { key: "declined", label: "Declined", hint: "lost or expired", statuses: ["Declined", "Expired"] },
  // Voided documents get their own card rather than being folded into
  // Declined. "The customer said no" and "we cancelled this" are
  // different events, and the second is the one somebody comes looking
  // for when they want to know what happened to a contract.
  { key: "void", label: "Voided", hint: "cancelled", statuses: ["Void"] },
  // Every status: a change order matters most while it is unsigned, so
  // splitting these across the other cards would bury the ones that need
  // chasing among contracts that don't.
  {
    key: "changes",
    label: "Attached",
    hint: "change orders & completions",
    statuses: ["Draft", "Sent", "Viewed", "Signed", "Declined", "Expired", "Void"],
  },
];

function initials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase())
      .join("") || "?"
  );
}

function shortDate(value: string | null) {
  if (!value) return "—";
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US");
}

export function EstimatesView({
  estimates,
  signers,
  leads,
  reps,
  canCreate,
}: {
  estimates: Estimate[];
  signers: EstimateSigner[];
  leads: EstimateLead[];
  reps: EstimateRep[];
  canCreate: boolean;
}) {
  const router = useRouter();
  const [bucket, setBucket] = useState<Bucket>("drafts");
  const [creating, setCreating] = useState(false);
  const [repFilter, setRepFilter] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());

  // Both filters clear when the card changes. Their options are drawn
  // from the current bucket, so a rep carried across to a card they have
  // no documents on would leave an empty table under a dropdown whose
  // boxes are all unticked -- the filter still applied, with nothing on
  // screen explaining why.
  function pickBucket(next: Bucket) {
    setBucket(next);
    setRepFilter(new Set());
    setStatusFilter(new Set());
  }

  const leadById = new Map(leads.map((l) => [l.id, l]));
  const repById = new Map(reps.map((r) => [r.id, r]));
  const signersByEstimate = new Map<string, EstimateSigner[]>();
  for (const s of signers) {
    const list = signersByEstimate.get(s.estimate_id) ?? [];
    list.push(s);
    signersByEstimate.set(s.estimate_id, list);
  }

  // An estimate past its expiry is treated as expired for counting and
  // filtering even while the stored status still says Sent -- nothing
  // sweeps the table on a timer, and a stale "awaiting signature" count is
  // worse than none.
  const effectiveStatus = (e: Estimate): EstimateStatus =>
    estimateExpired(e) ? "Expired" : e.status;

  // One list or the other, never both. Each card counts only its own
  // kind, so a change order cannot be tallied as a contract.
  // isSellableKind rather than a hand-written kind check: the funnel, the
  // commission base and the lead's value all ask the same question, and
  // each of them got it wrong in turn when change orders arrived.
  // Completion certificates are attachments to a contract too.
  const inBucket = (e: Estimate, b: Bucket, statuses: EstimateStatus[]) =>
    (b === "changes" ? !isSellableKind(e.kind) : isSellableKind(e.kind)) &&
    statuses.includes(effectiveStatus(e));

  const counts = BUCKETS.map((b) => {
    const rows = estimates.filter((e) => inBucket(e, b.key, b.statuses));
    return {
      ...b,
      count: rows.length,
      // Signed ones only for the change-order total. A draft is a
      // proposal, and adding it here would report money nobody has
      // agreed to as though the job had grown.
      totalCents: rows
        // Cancelled work is not money. Without this the Voided card would
        // report the value of everything that was called off as though it
        // were a pipeline worth chasing.
        .filter((e) => effectiveStatus(e) !== "Void")
        .filter((e) => b.key !== "changes" || effectiveStatus(e) === "Signed")
        .reduce((sum, e) => sum + (e.total_cents || 0), 0),
    };
  });

  const active = BUCKETS.find((b) => b.key === bucket)!;
  const inThisBucket = estimates.filter((e) => inBucket(e, active.key, active.statuses));

  // Options come from what is actually in the bucket, never from the
  // full list of reps or statuses.
  //
  // The funnel cards are already a status filter, so a second one drawn
  // from every status would offer Signed inside Drafts and return an
  // empty table -- the user then has to work out that the two controls
  // disagree. Derived this way the two cannot contradict each other:
  // Drafts offers only Draft, while Attached, which spans every status,
  // offers the real spread. Same for the salesperson: only people who
  // actually have a document here.
  const repOptions = [...new Set(inThisBucket.map((e) => e.assigned_to).filter(Boolean))]
    .map((id) => {
      const rep = repById.get(id as string);
      return { id: id as string, label: rep?.name || rep?.email || "Unnamed" };
    })
    .sort((a, b) => a.label.localeCompare(b.label));

  const statusOptions = [...new Set(inThisBucket.map((e) => effectiveStatus(e)))]
    .sort()
    .map((s) => ({ id: s, label: s }));

  const rows = inThisBucket.filter(
    (e) =>
      (repFilter.size === 0 || (e.assigned_to && repFilter.has(e.assigned_to))) &&
      (statusFilter.size === 0 || statusFilter.has(effectiveStatus(e)))
  );

  function customerName(e: Estimate) {
    const lead = leadById.get(e.lead_id);
    if (!lead) return "Unknown customer";
    return [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim() || "Unnamed lead";
  }

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Estimates &amp; Contracts</h1>
          <p className="module-sub">
            {(() => {
              const contracts = estimates.filter((e) => isSellableKind(e.kind)).length;
              const changes = estimates.length - contracts;
              if (contracts === 0 && changes === 0) return "No estimates yet";
              return (
                `${contracts} document${contracts === 1 ? "" : "s"}` +
                (changes ? ` · ${changes} attached document${changes === 1 ? "" : "s"}` : "")
              );
            })()}
          </p>
        </div>
        {canCreate && (
          <button className="btn-primary" onClick={() => setCreating(true)}>
            + New Estimate
          </button>
        )}
      </div>

      <div className="est-funnel">
        {counts.map((b) => (
          <button
            key={b.key}
            className={"est-funnel-card" + (bucket === b.key ? " est-funnel-active" : "")}
            onClick={() => pickBucket(b.key)}
            aria-pressed={bucket === b.key}
          >
            <span className="est-funnel-label">{b.label}</span>
            <span className="est-funnel-value">{moneyCents(b.totalCents)}</span>
            <span className="est-funnel-hint">
              {b.count} {b.hint}
            </span>
          </button>
        ))}
      </div>

      {/* Only offered when there is something to choose between. A
          dropdown holding one option filters nothing, and on the Drafts
          card -- where every row is a draft by definition -- a Status
          filter is exactly that. */}
      {(repOptions.length > 1 || statusOptions.length > 1) && (
        <div className="list-filters">
          {repOptions.length > 1 && (
            <FilterSelect
              title="SALESPERSON"
              options={repOptions}
              selected={repFilter}
              onChange={setRepFilter}
            />
          )}
          {statusOptions.length > 1 && (
            <FilterSelect
              title="STATUS"
              options={statusOptions}
              selected={statusFilter}
              onChange={setStatusFilter}
            />
          )}
          {rows.length !== inThisBucket.length && (
            <span className="list-filters-count">
              Showing {rows.length} of {inThisBucket.length}
            </span>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="empty-state">
          <p className="empty-label">Nothing in {active.label.toLowerCase()}</p>
          <p className="empty-hint">
            {bucket === "drafts" && canCreate
              ? "Start one with + New Estimate and link it to a lead."
              : "Documents move here as they progress."}
          </p>
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Doc #</th>
              <th>Customer</th>
              <th>Title</th>
              <th>Salesperson</th>
              <th>Date</th>
              <th>Status</th>
              <th className="right">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const lead = leadById.get(e.lead_id);
              const rep = e.assigned_to ? repById.get(e.assigned_to) : null;
              const sig = signatureProgress(signersByEstimate.get(e.id) ?? []);
              const status = effectiveStatus(e);
              // Nobody owes a signature on a document that is over.
              // Expired belongs here too: the price lapsed, so a partial
              // signature on it is history rather than an outstanding ask.
              const settled =
                status === "Void" || status === "Declined" || status === "Expired";
              return (
                <tr
                  key={e.id}
                  className="est-row"
                  onClick={() => router.push(`/estimates/${e.id}`)}
                  role="link"
                  tabIndex={0}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter") router.push(`/estimates/${e.id}`);
                  }}
                >
                  <td className="mono">{e.doc_number}</td>
                  <td>
                    <div className="ur-name-cell">
                      <span className="ur-avatar">{initials(customerName(e))}</span>
                      <div>
                        <div className="ur-name">{customerName(e)}</div>
                        <div className="ur-add-phone">{lead?.email || "—"}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="ur-name">{e.title || "Untitled"}</div>
                    <div className="ur-add-phone">{lead?.address || "—"}</div>
                  </td>
                  <td>{rep?.name || rep?.email || "—"}</td>
                  <td>
                    <div>{shortDate(e.created_at)}</div>
                    {e.expires_at && status !== "Signed" && (
                      <div className="ur-add-phone">Exp: {shortDate(e.expires_at)}</div>
                    )}
                  </td>
                  {/* Signature progress is shown INSTEAD of the status,
                      so a document that is finished with has to say so
                      first. A voided change order carrying one of two
                      signatures was reading "1/2 Signed — Pending: <the
                      customer>": it hid that the document was cancelled,
                      and named a real person as still owing a signature
                      on it. Somebody chases that. */}
                  <td>
                    <span className={"est-badge est-badge-" + status.toLowerCase()}>
                      {!settled && sig.total > 0 && sig.signed > 0 && !sig.complete
                        ? `${sig.signed}/${sig.total} Signed`
                        : status}
                    </span>
                    {!settled && sig.pending.length > 0 && sig.signed > 0 && (
                      <div className="ur-add-phone">Pending: {sig.pending.join(", ")}</div>
                    )}
                  </td>
                  <td className="right mono">
                    {e.total_cents ? moneyCents(e.total_cents) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {creating && (
        <NewEstimateDialog
          leads={leads}
          onClose={() => setCreating(false)}
          onCreated={(id) => router.push(`/estimates/${id}`)}
        />
      )}

      {/* canDelete is read on the document itself, where Delete and Void
          live. This list had `{!canDelete && null}` -- a line that renders
          nothing either way, and the only thing standing where a delete
          control appeared to be. */}
    </div>
  );
}
