"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  estimateExpired,
  moneyCents,
  signatureProgress,
  type Estimate,
  type EstimateSigner,
  type EstimateStatus,
} from "@/lib/data/types";
import { NewEstimateDialog } from "./new-estimate-dialog";

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
type Bucket = "drafts" | "sent" | "signed" | "declined";

const BUCKETS: { key: Bucket; label: string; hint: string; statuses: EstimateStatus[] }[] = [
  { key: "drafts", label: "Drafts", hint: "not sent yet", statuses: ["Draft"] },
  { key: "sent", label: "Proposals", hint: "awaiting signature", statuses: ["Sent", "Viewed"] },
  { key: "signed", label: "Contracts", hint: "signed", statuses: ["Signed"] },
  { key: "declined", label: "Declined", hint: "lost or expired", statuses: ["Declined", "Expired"] },
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
  canDelete,
  canCreate,
}: {
  estimates: Estimate[];
  signers: EstimateSigner[];
  leads: EstimateLead[];
  reps: EstimateRep[];
  canDelete: boolean;
  canCreate: boolean;
}) {
  const router = useRouter();
  const [bucket, setBucket] = useState<Bucket>("drafts");
  const [creating, setCreating] = useState(false);

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

  const counts = BUCKETS.map((b) => {
    const rows = estimates.filter((e) => b.statuses.includes(effectiveStatus(e)));
    return {
      ...b,
      count: rows.length,
      totalCents: rows.reduce((sum, e) => sum + (e.total_cents || 0), 0),
    };
  });

  const active = BUCKETS.find((b) => b.key === bucket)!;
  const rows = estimates.filter((e) => active.statuses.includes(effectiveStatus(e)));

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
            {estimates.length === 0
              ? "No estimates yet"
              : `${estimates.length} document${estimates.length === 1 ? "" : "s"}`}
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
            onClick={() => setBucket(b.key)}
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
                  <td>
                    <span className={"est-badge est-badge-" + status.toLowerCase()}>
                      {sig.total > 0 && sig.signed > 0 && !sig.complete
                        ? `${sig.signed}/${sig.total} Signed`
                        : status}
                    </span>
                    {sig.pending.length > 0 && sig.signed > 0 && (
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

      {!canDelete && null}
    </div>
  );
}
