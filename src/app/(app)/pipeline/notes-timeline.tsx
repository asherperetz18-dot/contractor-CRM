"use client";

import { useState } from "react";
import type { LeadNote, Profile } from "@/lib/data/types";
import { addLeadNote, deleteLeadNote } from "@/lib/actions/lead-notes";
import { attempt } from "@/lib/appointment-save";

/**
 * The note being typed, held by whoever owns it. The panel unmounts on a
 * tab switch, so a note kept inside it vanished when someone clicked
 * away -- a window that wants it to survive (and its own Save to add it)
 * holds it with this hook and passes it in (DECISIONS #190).
 */
export function useNoteDraft() {
  const [body, setBody] = useState("");
  // On its way to the server, by Add Note or the window's Save: the other
  // waits, so a double tap on a slow signal can't add it twice.
  const [busy, setBusy] = useState(false);
  return { body, setBody, busy, setBusy, waiting: body.trim() !== "" };
}

export type NoteDraft = ReturnType<typeof useNoteDraft>;

export function NotesTimeline({
  leadId,
  notes,
  reps,
  readOnly,
  onChanged,
  draft,
}: {
  leadId: string;
  notes: LeadNote[];
  reps: Profile[];
  readOnly?: boolean;
  onChanged: () => void;
  // Held by the host so it outlives a tab switch; the panel keeps its own
  // when none is given.
  draft?: NoteDraft;
}) {
  const own = useNoteDraft();
  const { body, setBody, busy, setBusy } = draft ?? own;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  function authorName(id: string | null) {
    if (!id) return "System";
    const rep = reps.find((r) => r.id === id);
    return rep?.name || rep?.email || "Unknown";
  }

  const sorted = [...notes].sort((a, b) => b.created_at.localeCompare(a.created_at));

  // Both calls go through attempt: one that never reaches the server says
  // so instead of leaving Add Note on "Adding…", and a refusal is shown.
  async function handleAdd() {
    if (!body.trim()) {
      setError("Type the note first.");
      return;
    }
    setPending(true);
    setBusy(true);
    setError("");
    const result = await attempt(() => addLeadNote(leadId, body));
    setPending(false);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setBody("");
    onChanged();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this note?")) return;
    setError("");
    const result = await attempt(() => deleteLeadNote(id));
    if (result.error) {
      setError(result.error);
      return;
    }
    onChanged();
  }

  return (
    <div className="second-contact-block">
      <div className="second-contact-head">
        <span>Activity &amp; Notes</span>
      </div>

      {sorted.length === 0 ? (
        <p className="empty-hint">No activity yet.</p>
      ) : (
        <div className="notes-timeline">
          {sorted.map((n) => (
            <div key={n.id} className="notes-timeline-item">
              <div className="notes-timeline-body">{n.body}</div>
              <div className="notes-timeline-meta">
                <span>{authorName(n.author_id)}</span>
                <span>·</span>
                <span>
                  {new Date(n.created_at).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
                {n.event_id && <span className="badge-chip notes-timeline-tag">📅 Appointment</span>}
                {!readOnly && (
                  <button
                    type="button"
                    className="icon-btn notes-timeline-delete"
                    onClick={() => handleDelete(n.id)}
                    aria-label="Delete note"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {!readOnly && (
        <div style={{ marginTop: 10 }}>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            placeholder="Add a note…"
            disabled={busy}
          />
          {error && <p className="error-note">{error}</p>}
          <div className="modal-actions">
            <div />
            <div>
              <button
                type="button"
                className="btn-primary small"
                onClick={handleAdd}
                disabled={pending || busy}
              >
                {pending ? "Adding…" : "Add Note"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
