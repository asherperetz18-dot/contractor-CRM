"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { moneyCents } from "@/lib/data/types";
import {
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
 * Given its data by the page rather than fetching it. The whole book is
 * 37 estimates, so loading them once and grouping by lead costs less
 * than a round trip per card -- and the chip is present on the first
 * frame instead of appearing a couple of seconds in.
 */
export function LeadEstimateButton({
  leadId,
  estimates,
  paidCents,
  canView,
  canCreate,
}: {
  leadId: string;
  /** Handed down from the page, not fetched. The chip used to arrive a
   *  couple of seconds after the card opened and shove the rest of the
   *  row sideways as it did. */
  estimates: LeadEstimateSummary[];
  paidCents: number;
  canView: boolean;
  canCreate: boolean;
}) {
  const router = useRouter();
  const [listOpen, setListOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // No estimate access at all: nothing to say, and saying it on every
  // contact would just be noise for a role that never touches paperwork.
  if (!canView) return null;

  /**
   * Access to estimates, but nothing to open on this contact and no
   * right to start one.
   *
   * Rendered rather than skipped. Disappearing is indistinguishable from
   * the feature not existing -- a dispatcher looking at a lead that is
   * not theirs saw an empty space and reported the button as missing.
   * The state is real and worth naming.
   */
  if (estimates.length === 0 && !canCreate) {
    return (
      <span
        className="chip lead-est-none"
        title="Either nothing has been drawn up for this contact, or it belongs to someone else's leads"
      >
        No estimate
      </span>
    );
  }

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
