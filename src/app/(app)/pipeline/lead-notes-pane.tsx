"use client";

import { useCallback, useEffect, useState } from "react";
import type { LeadNote, Profile } from "@/lib/data/types";
import {
  kindLabel,
  sortSharedNotes,
  STAFF_NOTE_KINDS,
  type SharedNote,
  type SharedNoteKind,
} from "@/lib/data/shared-notes";
import {
  addSharedNote,
  answerSharedNote,
  editSharedNote,
  getSharedNotes,
  setSharedNotePinned,
} from "@/lib/actions/shared-notes";
import { NotesTimeline } from "./notes-timeline";

type Side = "internal" | "shared";

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * The lead card's Notes tab: the team's internal timeline, and the notes
 * shared with the client in the portal. Two sides of one switch, never
 * one mixed list -- a note must never be a click away from the client by
 * accident, so the shared side carries a standing "the client sees this"
 * banner above its composer.
 */
export function LeadNotesPane({
  leadId,
  notes,
  reps,
  readOnly,
  onChanged,
  clientName,
}: {
  leadId: string;
  notes: LeadNote[];
  reps: Profile[];
  readOnly?: boolean;
  onChanged: () => void;
  clientName: string;
}) {
  const [side, setSide] = useState<Side>("internal");
  const [shared, setShared] = useState<SharedNote[] | null | undefined>(undefined);
  const [canWrite, setCanWrite] = useState(false);
  const [me, setMe] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await getSharedNotes(leadId);
    setShared(res.notes);
    setCanWrite(res.canWrite);
    setMe(res.me);
  }, [leadId]);

  useEffect(() => {
    // Loaded with the tab rather than with the card: the switch shows
    // the shared count, and the rest of the card never needs these.
    // Cancelled on unmount / lead change so a slow answer can't write
    // one contact's notes into another's card.
    let cancelled = false;
    (async () => {
      const res = await getSharedNotes(leadId);
      if (cancelled) return;
      setShared(res.notes);
      setCanWrite(res.canWrite);
      setMe(res.me);
    })();
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  const unseen = (shared ?? []).filter((n) => n.author_kind === "client" && !n.staff_seen_at).length;

  return (
    <div>
      <div className="notes-side-switch" role="tablist" aria-label="Which notes">
        <button
          type="button"
          role="tab"
          aria-selected={side === "internal"}
          className={side === "internal" ? "on" : ""}
          onClick={() => setSide("internal")}
        >
          🔒 Internal · {notes.length}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={side === "shared"}
          className={side === "shared" ? "on" : ""}
          onClick={() => setSide("shared")}
        >
          👁 Shared with client{shared ? ` · ${shared.length}` : ""}
          {unseen > 0 && <span className="notes-side-new">{unseen} new</span>}
        </button>
      </div>

      {side === "internal" ? (
        <NotesTimeline leadId={leadId} notes={notes} reps={reps} readOnly={readOnly} onChanged={onChanged} />
      ) : (
        <SharedNotesList
          leadId={leadId}
          notes={shared}
          reps={reps}
          canWrite={canWrite}
          me={me}
          clientName={clientName}
          onChanged={load}
        />
      )}
    </div>
  );
}

function SharedNotesList({
  leadId,
  notes,
  reps,
  canWrite,
  me,
  clientName,
  onChanged,
}: {
  leadId: string;
  notes: SharedNote[] | null | undefined;
  reps: Profile[];
  canWrite: boolean;
  me: string | null;
  clientName: string;
  onChanged: () => Promise<void>;
}) {
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<SharedNoteKind | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [answering, setAnswering] = useState<{ id: string; body: string } | null>(null);

  const client = clientName || "The client";

  function repName(id: string | null) {
    if (!id) return "Someone on the team";
    const r = reps.find((x) => x.id === id);
    return r?.name || r?.email || "Someone on the team";
  }

  async function run(key: string, action: () => Promise<{ error?: string }>) {
    setBusy(key);
    setError("");
    const res = await action();
    if (res.error) {
      setBusy("");
      setError(res.error);
      return false;
    }
    await onChanged();
    setBusy("");
    return true;
  }

  if (notes === undefined) return <p className="empty-hint">Loading shared notes…</p>;
  if (notes === null) {
    return (
      <p className="empty-hint">
        Shared notes aren&apos;t switched on yet. An admin needs to run migration 0183 in Supabase.
      </p>
    );
  }

  return (
    <div className="second-contact-block">
      <div className="shared-notes-banner">
        <span aria-hidden="true">👁</span>
        <span>
          {client} sees everything on this side in the client portal. Pricing thoughts, crew issues and
          sales notes go under <b>Internal</b>.
        </span>
      </div>

      {notes.length === 0 ? (
        <p className="empty-hint">No shared notes yet.</p>
      ) : (
        <div className="shared-notes-list staff">
          {sortSharedNotes(notes).map((n) => {
            const fromClient = n.author_kind === "client";
            return (
              <article
                key={n.id}
                className={
                  "shared-note" + (fromClient ? " from-client" : "") + (n.pinned ? " pinned" : "")
                }
              >
                <div className="shared-note-meta">
                  <span className="shared-note-who">
                    {fromClient ? `${client} (client)` : repName(n.author_id)}
                  </span>
                  {n.kind && <span className={`shared-note-kind k-${n.kind}`}>{kindLabel(n.kind, "staff")}</span>}
                  {fromClient && !n.staff_seen_at && <span className="shared-note-new">● New</span>}
                  <span className="shared-note-spacer" />
                  {n.pinned && <span className="shared-note-pin">📌 Pinned</span>}
                  <span>
                    {when(n.created_at)}
                    {n.edited_at ? " · edited" : ""}
                  </span>
                </div>

                {editing?.id === n.id ? (
                  <div className="shared-note-inline">
                    <textarea
                      id={`shared-note-edit-${n.id}`}
                      rows={3}
                      value={editing.body}
                      onChange={(e) => setEditing({ id: n.id, body: e.target.value })}
                    />
                    <div className="shared-note-actions">
                      <button
                        type="button"
                        className="btn-primary small"
                        disabled={busy === `edit:${n.id}`}
                        onClick={async () => {
                          if (await run(`edit:${n.id}`, () => editSharedNote(n.id, editing.body))) setEditing(null);
                        }}
                      >
                        Save
                      </button>
                      <button type="button" className="btn-ghost small" onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="shared-note-body">{n.body}</p>
                )}

                {n.answered_at && (
                  <div className="shared-note-answer">
                    <span className="shared-note-check" aria-hidden="true">
                      ✓
                    </span>
                    <span>
                      Answered by {repName(n.answered_by)}
                      {n.answer ? `: ${n.answer}` : ""}
                    </span>
                  </div>
                )}

                {answering?.id === n.id && (
                  <div className="shared-note-inline">
                    <textarea
                      id={`shared-note-answer-${n.id}`}
                      rows={2}
                      value={answering.body}
                      onChange={(e) => setAnswering({ id: n.id, body: e.target.value })}
                      placeholder={`Your answer — ${client} will see it under the question`}
                    />
                    <div className="shared-note-actions">
                      <button
                        type="button"
                        className="btn-primary small"
                        disabled={busy === `answer:${n.id}`}
                        onClick={async () => {
                          if (await run(`answer:${n.id}`, () => answerSharedNote(n.id, answering.body))) {
                            setAnswering(null);
                          }
                        }}
                      >
                        {answering.body.trim() ? "Send answer" : "Mark answered"}
                      </button>
                      <button type="button" className="btn-ghost small" onClick={() => setAnswering(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {canWrite && editing?.id !== n.id && answering?.id !== n.id && (
                  <div className="shared-note-links">
                    {n.kind === "question" && !n.answered_at && (
                      <button type="button" onClick={() => setAnswering({ id: n.id, body: "" })}>
                        Answer
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy === `pin:${n.id}`}
                      onClick={() => run(`pin:${n.id}`, () => setSharedNotePinned(n.id, !n.pinned))}
                    >
                      {n.pinned ? "Unpin" : "Pin"}
                    </button>
                    {!fromClient && n.author_id === me && (
                      <button type="button" onClick={() => setEditing({ id: n.id, body: n.body })}>
                        Edit
                      </button>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {canWrite && (
        <div className="shared-notes-composer staff">
          <label htmlFor="staff-shared-note" className="shared-notes-composer-label">
            Add a shared note · visible to {client}
          </label>
          <textarea
            id="staff-shared-note"
            rows={2}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write a note the client will see…"
          />
          <div className="shared-notes-composer-row">
            <div className="shared-notes-kinds" role="radiogroup" aria-label="Tag">
              <button
                type="button"
                role="radio"
                aria-checked={kind === null}
                className={kind === null ? "shared-notes-kind on" : "shared-notes-kind"}
                onClick={() => setKind(null)}
              >
                Note
              </button>
              {STAFF_NOTE_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={kind === k}
                  className={kind === k ? `shared-notes-kind on k-${k}` : "shared-notes-kind"}
                  onClick={() => setKind(k)}
                >
                  {kindLabel(k, "staff")}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn-primary small"
              disabled={busy === "add" || !body.trim()}
              onClick={async () => {
                if (await run("add", () => addSharedNote(leadId, body, kind))) {
                  setBody("");
                  setKind(null);
                }
              }}
            >
              {busy === "add" ? "Sharing…" : "Share note"}
            </button>
          </div>
        </div>
      )}
      {error && <p className="error-note">{error}</p>}
    </div>
  );
}
