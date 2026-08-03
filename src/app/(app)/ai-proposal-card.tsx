"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  applyProposal,
  describeProposalTargets,
  rejectProposal,
} from "@/lib/actions/ai-actions";
import { AI_ACTION_LABEL, type ProposalRow } from "@/lib/data/ai-proposals";

export function AiProposalCard({ proposal }: { proposal: ProposalRow }) {
  const router = useRouter();
  const [status, setStatus] = useState(proposal.status);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [names, setNames] = useState<string[] | null>(null);
  const [missing, setMissing] = useState(0);
  const [showAll, setShowAll] = useState(false);

  // Resolved live rather than trusted from the proposal, so the reviewer
  // sees who would actually be affected right now.
  useEffect(() => {
    let active = true;
    describeProposalTargets(proposal.id).then((r) => {
      if (!active) return;
      setNames(r.names);
      setMissing(r.missing);
    });
    return () => {
      active = false;
    };
  }, [proposal.id]);

  async function approve() {
    setPending(true);
    setError("");
    const result = await applyProposal(proposal.id);
    setPending(false);
    if (result.error) {
      setError(result.error);
      setStatus("failed");
      return;
    }
    setStatus("applied");
    router.refresh();
  }

  async function dismiss() {
    setPending(true);
    setError("");
    const result = await rejectProposal(proposal.id);
    setPending(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    setStatus("rejected");
  }

  const visible = names ? (showAll ? names : names.slice(0, 5)) : [];

  return (
    <div className="ai-proposal">
      <div className="ai-proposal-head">
        <span className="ai-proposal-kind">
          {AI_ACTION_LABEL[proposal.action_type] || proposal.action_type}
        </span>
        <span className="ai-proposal-count">
          {proposal.target_count} contact{proposal.target_count === 1 ? "" : "s"}
        </span>
      </div>

      <p className="ai-proposal-summary">{proposal.summary}</p>

      {names === null ? (
        <p className="ai-proposal-targets">Checking which contacts this affects…</p>
      ) : (
        <div className="ai-proposal-targets">
          {visible.join(", ")}
          {names.length > 5 && !showAll && (
            <>
              {" "}
              <button type="button" className="link-btn" onClick={() => setShowAll(true)}>
                +{names.length - 5} more
              </button>
            </>
          )}
          {missing > 0 && (
            <div className="ai-proposal-warn">
              {missing} suggested record{missing === 1 ? "" : "s"} no longer match your data and
              will be skipped.
            </div>
          )}
        </div>
      )}

      {error && <p className="error-note">{error}</p>}

      {status === "pending" ? (
        <div className="ai-proposal-actions">
          <button
            type="button"
            className="btn-primary small"
            onClick={approve}
            disabled={pending || !names?.length}
          >
            {pending ? "Applying…" : "Approve"}
          </button>
          <button type="button" className="btn-ghost small" onClick={dismiss} disabled={pending}>
            Dismiss
          </button>
        </div>
      ) : (
        <p className={status === "applied" ? "ai-proposal-done" : "ai-proposal-dismissed"}>
          {status === "applied" && "✓ Applied"}
          {status === "rejected" && "Dismissed"}
          {status === "failed" && "Couldn't be applied"}
        </p>
      )}
    </div>
  );
}
