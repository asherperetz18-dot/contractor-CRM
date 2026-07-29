"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import {
  dismissDuplicatePair,
  findDuplicateLeads,
  mergeLeads,
  type DuplicatePair,
} from "@/lib/actions/duplicates";
import { leadDisplayName } from "@/lib/data/types";

const REASON_LABEL: Record<string, string> = {
  phone: "Same phone",
  email: "Same email",
};

function pairKey(pair: DuplicatePair) {
  return `${pair.leadA.id}:${pair.leadB.id}`;
}

export function DuplicateContactsButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pairs, setPairs] = useState<DuplicatePair[] | null>(null);
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);

  async function openTool() {
    setOpen(true);
    setLoading(true);
    setError("");
    const result = await findDuplicateLeads();
    setLoading(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setPairs(result.pairs ?? []);
  }

  async function handleDismiss(pair: DuplicatePair) {
    setBusyKey(pairKey(pair));
    await dismissDuplicatePair(pair.leadA.id, pair.leadB.id);
    setPairs((prev) => (prev ?? []).filter((p) => pairKey(p) !== pairKey(pair)));
    setBusyKey(null);
  }

  async function handleMerge(pair: DuplicatePair, keepId: string) {
    const dropId = keepId === pair.leadA.id ? pair.leadB.id : pair.leadA.id;
    const kept = keepId === pair.leadA.id ? pair.leadA : pair.leadB;
    if (
      !confirm(
        `Merge into "${leadDisplayName(kept)}"? All appointments, notes, files, calls, and texts from the other contact will move over, and the other contact will be deleted. This can't be undone.`
      )
    ) {
      return;
    }
    setBusyKey(pairKey(pair));
    const result = await mergeLeads(keepId, dropId);
    setBusyKey(null);
    if (result?.error) {
      setError(result.error);
      return;
    }
    setPairs((prev) => (prev ?? []).filter((p) => pairKey(p) !== pairKey(pair)));
    router.refresh();
  }

  return (
    <>
      <button
        className="icon-btn topbar-icon-btn"
        onClick={openTool}
        aria-label="Check for duplicate contacts"
        title="Check for duplicate contacts"
      >
        ⧉
      </button>
      {open && (
        <Modal title="Potential Duplicate Contacts" onClose={() => setOpen(false)} wide>
          {loading && <p className="hint-note">Scanning contacts…</p>}
          {error && <p className="error-note">{error}</p>}
          {!loading && pairs && pairs.length === 0 && (
            <p className="hint-note">No potential duplicates found.</p>
          )}
          {!loading && pairs && pairs.length > 0 && (
            <>
              <p className="hint-note">
                Found {pairs.length} potential duplicate{pairs.length === 1 ? "" : "s"}. Pick which
                contact to keep, or mark a pair as not a duplicate.
              </p>
              <div className="dup-pair-list">
                {pairs.map((pair) => {
                  const busy = busyKey === pairKey(pair);
                  return (
                    <div key={pairKey(pair)} className="dup-pair-card">
                      <div className="dup-pair-reasons">
                        {pair.reasons.map((r) => (
                          <Badge key={r} color="#C7691B">
                            {REASON_LABEL[r] ?? r}
                          </Badge>
                        ))}
                      </div>
                      <div className="dup-pair-sides">
                        {[pair.leadA, pair.leadB].map((lead) => (
                          <div key={lead.id} className="dup-pair-side">
                            <div className="ur-name">{leadDisplayName(lead)}</div>
                            <div className="ur-add-phone">{lead.phone || "—"}</div>
                            <div className="ur-add-phone">{lead.email || "—"}</div>
                            <div className="ur-add-phone">Source: {lead.source || "—"}</div>
                            <button
                              type="button"
                              className="btn-primary small"
                              onClick={() => handleMerge(pair, lead.id)}
                              disabled={busy}
                            >
                              {busy ? "Merging…" : `Keep this one`}
                            </button>
                          </div>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="btn-ghost small"
                        onClick={() => handleDismiss(pair)}
                        disabled={busy}
                      >
                        Not a duplicate
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
