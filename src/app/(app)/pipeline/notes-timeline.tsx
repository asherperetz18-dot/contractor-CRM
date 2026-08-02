"use client";

import { useState } from "react";
import type { LeadNote, Profile } from "@/lib/data/types";
import { addLeadNote, deleteLeadNote } from "@/lib/actions/lead-notes";

export function NotesTimeline({
  leadId,
  notes,
  reps,
  readOnly,
  onChanged,
}: {
  leadId: string;
  notes: LeadNote[];
  reps: Profile[];
  readOnly?: boolean;
  onChanged: () => void;
}) {
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  function authorName(id: string | null) {
    if (!id) return "System";
    const rep = reps.find((r) => r.id === id);
    return rep?.name || rep?.email || "Unknown";
  }

  const sorted = [...notes].sort((a, b) => b.created_at.localeCompare(a.created_at));

  async function handleAdd() {
    if (!body.trim()) return;
    setPending(true);
    setError("");
    const result = await addLeadNote(leadId, body);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setBody("");
    onChanged();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this note?")) return;
    await deleteLeadNote(id);
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
          />
          {error && <p className="error-note">{error}</p>}
          <div className="modal-actions">
            <div />
            <div>
              <button
                type="button"
                className="btn-primary small"
                onClick={handleAdd}
                disabled={pending}
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
