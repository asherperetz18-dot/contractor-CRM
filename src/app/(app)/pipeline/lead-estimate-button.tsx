"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { moneyCents } from "@/lib/data/types";
import {
  getEstimatesForLead,
  openOrCreateEstimateForLead,
  type LeadEstimateSummary,
} from "@/lib/actions/estimates";

/**
 * Route from a lead straight to its estimate.
 *
 * One estimate opens it. Several list them, because picking the newest
 * for someone would be a guess -- a lead with a signed contract and a
 * fresh revision has two very different documents on it. None starts one,
 * titled from the lead's project type.
 *
 * Fetches its own data like LeadViewTrail does, so the pipeline page does
 * not have to load every estimate to render a modal that is usually shut.
 */
export function LeadEstimateButton({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [estimates, setEstimates] = useState<LeadEstimateSummary[] | null>(null);
  const [canCreate, setCanCreate] = useState(false);
  const [paidCents, setPaidCents] = useState(0);
  const [listOpen, setListOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await getEstimatesForLead(leadId);
      if (cancelled) return;
      setEstimates(res.estimates);
      setCanCreate(res.canCreate);
      setPaidCents(res.paidCents);
    })();
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  // Still loading, or this person has no access to estimates at all.
  if (estimates === null) return null;
  if (estimates.length === 0 && !canCreate) return null;

  function go() {
    if (estimates && estimates.length > 1) {
      setListOpen((v) => !v);
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await openOrCreateEstimateForLead(leadId);
      if (res.error) return setError(res.error);
      if (res.id) router.push(`/estimates/${res.id}`);
    });
  }

  const count = estimates.length;
  return (
    <span className="lead-est-wrap">
      <button
        type="button"
        className="chip"
        onClick={go}
        disabled={pending}
        title={
          count === 0
            ? "Start an estimate for this contact"
            : count === 1
              ? "Open this contact's estimate"
              : `${count} estimates on this contact`
        }
      >
        {pending ? "Opening…" : count === 0 ? "+ Estimate" : `Estimates (${count})`}
      </button>
      {/* Money in, at a glance -- a rep should not have to open Admin
          Settings to find out whether the deposit landed. */}
      {paidCents > 0 && (
        <span className="lead-est-paid" title="Paid online through the portal">
          {moneyCents(paidCents)} paid
        </span>
      )}

      {listOpen && count > 1 && (
        <div className="lead-est-menu">
          {estimates.map((e) => (
            <button
              key={e.id}
              type="button"
              className="lead-est-item"
              onClick={() => router.push(`/estimates/${e.id}`)}
            >
              <span className="mono">{e.doc_number}</span>
              <span className="lead-est-title">{e.title || "Untitled"}</span>
              <span className={"est-badge est-badge-" + e.status.toLowerCase()}>{e.status}</span>
              <span className="mono">{e.total_cents ? moneyCents(e.total_cents) : "—"}</span>
            </button>
          ))}
          {canCreate && (
            <button
              type="button"
              className="lead-est-item lead-est-new"
              onClick={() => {
                setListOpen(false);
                startTransition(async () => {
                  const res = await openOrCreateEstimateForLead(leadId);
                  if (res.error) return setError(res.error);
                  if (res.id) router.push(`/estimates/${res.id}`);
                });
              }}
            >
              + New estimate
            </button>
          )}
        </div>
      )}

      {error && <span className="error-note lead-est-error">{error}</span>}
    </span>
  );
}
