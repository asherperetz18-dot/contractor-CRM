"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import {
  dismissDuplicatePair,
  findDuplicateLeads,
  getMergePreview,
  mergeLeads,
  type DuplicatePair,
  type MergePreviewSide,
} from "@/lib/actions/duplicates";
import { leadDisplayName } from "@/lib/data/types";

const REASON_LABEL: Record<string, string> = {
  phone: "Same phone",
  email: "Same email",
};

function pairKey(pair: DuplicatePair) {
  return `${pair.leadA.id}:${pair.leadB.id}`;
}

function fmtDate(d: string) {
  const date = new Date(d);
  return isNaN(date.getTime()) ? d : date.toLocaleDateString();
}

function SidePreview({ label, side }: { label: string; side: MergePreviewSide | null }) {
  const empty = !side || (
    side.notes.length === 0 &&
    side.files.length === 0 &&
    side.calls.length === 0 &&
    side.texts.length === 0 &&
    side.events.length === 0
  );
  return (
    <div className="dup-preview-side">
      <div className="dup-preview-side-label">{label}</div>
      {!side ? (
        <p className="hint-note">Loading…</p>
      ) : empty ? (
        <p className="hint-note">No notes, files, calls, texts, or appointments on this contact.</p>
      ) : (
        <>
          {side.events.length > 0 && (
            <div className="dup-preview-group">
              <div className="dup-preview-group-label">Appointments ({side.events.length})</div>
              {side.events.map((e) => (
                <div key={e.id} className="dup-preview-item">
                  {fmtDate(e.date)} {e.time || ""} — {e.event_type} ({e.status})
                  {e.title ? `: ${e.title}` : ""}
                </div>
              ))}
            </div>
          )}
          {side.notes.length > 0 && (
            <div className="dup-preview-group">
              <div className="dup-preview-group-label">Notes ({side.notes.length})</div>
              {side.notes.map((n) => (
                <div key={n.id} className="dup-preview-item">
                  <span className="ur-add-phone">{fmtDate(n.created_at)}</span> — {n.body}
                </div>
              ))}
            </div>
          )}
          {side.files.length > 0 && (
            <div className="dup-preview-group">
              <div className="dup-preview-group-label">Files ({side.files.length})</div>
              {side.files.map((f) => (
                <div key={f.id} className="dup-preview-item">
                  <a href={f.file_url} target="_blank" rel="noreferrer">
                    {f.file_name}
                  </a>{" "}
                  <span className="ur-add-phone">({fmtDate(f.created_at)})</span>
                </div>
              ))}
            </div>
          )}
          {side.calls.length > 0 && (
            <div className="dup-preview-group">
              <div className="dup-preview-group-label">Calls ({side.calls.length})</div>
              {side.calls.map((c) => (
                <div key={c.id} className="dup-preview-item">
                  {fmtDate(c.created_at)} — {c.direction}, {Math.round(c.duration_seconds / 60)}min
                  {c.disposition ? `, ${c.disposition}` : ""}
                </div>
              ))}
            </div>
          )}
          {side.texts.length > 0 && (
            <div className="dup-preview-group">
              <div className="dup-preview-group-label">Texts ({side.texts.length})</div>
              {side.texts.map((t) => (
                <div key={t.id} className="dup-preview-item">
                  <span className="ur-add-phone">
                    {fmtDate(t.created_at)} ({t.direction})
                  </span>{" "}
                  — {t.body}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function DuplicateContactsButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pairs, setPairs] = useState<DuplicatePair[] | null>(null);
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [previewPair, setPreviewPair] = useState<DuplicatePair | null>(null);
  const [previewKeepId, setPreviewKeepId] = useState<string | null>(null);
  const [previewSides, setPreviewSides] = useState<Record<string, MergePreviewSide> | null>(null);
  const [mergePending, setMergePending] = useState(false);

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

  async function startPreview(pair: DuplicatePair, keepId: string) {
    setPreviewPair(pair);
    setPreviewKeepId(keepId);
    setPreviewSides(null);
    setError("");
    const result = await getMergePreview(pair.leadA.id, pair.leadB.id);
    if (result.error) {
      setError(result.error);
      setPreviewPair(null);
      setPreviewKeepId(null);
      return;
    }
    setPreviewSides(result.sides ?? null);
  }

  function cancelPreview() {
    setPreviewPair(null);
    setPreviewKeepId(null);
    setPreviewSides(null);
  }

  async function confirmMerge() {
    if (!previewPair || !previewKeepId) return;
    const dropId = previewKeepId === previewPair.leadA.id ? previewPair.leadB.id : previewPair.leadA.id;
    setMergePending(true);
    setError("");
    const result = await mergeLeads(previewKeepId, dropId);
    setMergePending(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    setPairs((prev) => (prev ?? []).filter((p) => pairKey(p) !== pairKey(previewPair)));
    cancelPreview();
    router.refresh();
  }

  function closeModal() {
    setOpen(false);
    cancelPreview();
  }

  const keptLead =
    previewPair && previewKeepId
      ? previewKeepId === previewPair.leadA.id
        ? previewPair.leadA
        : previewPair.leadB
      : null;
  const droppedLead =
    previewPair && previewKeepId
      ? previewKeepId === previewPair.leadA.id
        ? previewPair.leadB
        : previewPair.leadA
      : null;

  return (
    <>
      <button
        className="icon-btn topbar-icon-btn topbar-desktop-only"
        onClick={openTool}
        aria-label="Check for duplicate contacts"
        title="Check for duplicate contacts"
      >
        ⧉
      </button>
      {open && (
        <Modal
          title={previewPair ? "Review Before Merging" : "Potential Duplicate Contacts"}
          onClose={closeModal}
          wide
        >
          {error && <p className="error-note">{error}</p>}

          {previewPair && keptLead && droppedLead ? (
            <>
              <p className="hint-note">
                Keeping <strong>{leadDisplayName(keptLead)}</strong>. Everything below on{" "}
                <strong>{leadDisplayName(droppedLead)}</strong> will move over, and that contact
                will then be deleted. This can&apos;t be undone.
              </p>
              <div className="dup-preview-sides">
                <SidePreview
                  label={`${leadDisplayName(keptLead)} (kept)`}
                  side={previewSides?.[keptLead.id] ?? null}
                />
                <SidePreview
                  label={`${leadDisplayName(droppedLead)} (will be deleted after merge)`}
                  side={previewSides?.[droppedLead.id] ?? null}
                />
              </div>
              <div className="modal-actions">
                <div />
                <div>
                  <button className="btn-ghost" onClick={cancelPreview} disabled={mergePending}>
                    Back
                  </button>
                  <button
                    className="btn-primary"
                    onClick={confirmMerge}
                    disabled={mergePending || !previewSides}
                  >
                    {mergePending ? "Merging…" : "Confirm Merge"}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              {loading && <p className="hint-note">Scanning contacts…</p>}
              {!loading && pairs && pairs.length === 0 && (
                <p className="hint-note">No potential duplicates found.</p>
              )}
              {!loading && pairs && pairs.length > 0 && (
                <>
                  <p className="hint-note">
                    Found {pairs.length} potential duplicate{pairs.length === 1 ? "" : "s"}. Pick
                    which contact to keep, or mark a pair as not a duplicate.
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
                                  onClick={() => startPreview(pair, lead.id)}
                                  disabled={busy}
                                >
                                  Keep this one
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
            </>
          )}
        </Modal>
      )}
    </>
  );
}
