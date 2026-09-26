"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { portalAddSharedNote } from "@/lib/actions/portal";
import {
  CLIENT_NOTE_KINDS,
  kindCounts,
  kindLabel,
  kindPlural,
  SHARED_NOTE_KINDS,
  sortSharedNotes,
  type SharedNote,
  type SharedNoteKind,
} from "@/lib/data/shared-notes";

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * The client's Notes tab: the project's written record, shared with the
 * team. Messages are the conversation; this is what was decided and
 * picked. The client adds notes but can't edit one once it's posted.
 */
export function PortalNotes({
  notes,
  clientName,
  companyName,
  repName,
}: {
  notes: SharedNote[];
  clientName: string;
  companyName: string;
  repName: (id: string | null) => string | null;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<SharedNoteKind | "all">("all");
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<SharedNoteKind | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const counts = kindCounts(notes);
  const shown = sortSharedNotes(filter === "all" ? notes : notes.filter((n) => n.kind === filter));

  async function add() {
    setSaving(true);
    setError("");
    const result = await portalAddSharedNote(body, kind);
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setBody("");
    setKind(null);
    setFilter("all");
    router.refresh();
  }

  return (
    <section className="portal-card">
      <div className="portal-card-head">
        <span className="portal-ico portal-ico-amber" aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
            <path d="M14 3v5h5M9 13h6M9 17h4" />
          </svg>
        </span>
        <h2 className="portal-card-title">Project notes</h2>
      </div>
      <p className="shared-notes-sub">
        Shared between you and our team. Everything here is part of your project record.
      </p>

      {notes.length > 0 && (
        <div className="shared-notes-filters">
          <button
            type="button"
            className={filter === "all" ? "shared-notes-filter on" : "shared-notes-filter"}
            onClick={() => setFilter("all")}
          >
            All {notes.length}
          </button>
          {SHARED_NOTE_KINDS.filter((k) => counts[k] > 0).map((k) => (
            <button
              key={k}
              type="button"
              className={filter === k ? "shared-notes-filter on" : "shared-notes-filter"}
              onClick={() => setFilter(k)}
            >
              {kindPlural(k)} {counts[k]}
            </button>
          ))}
        </div>
      )}

      {notes.length === 0 ? (
        <p className="portal-empty">
          No notes yet. Use notes for anything worth keeping: a finish you picked, a decision, a
          question for the team.
        </p>
      ) : (
        <div className="shared-notes-list">
          {shown.map((n) => {
            const staffName = n.author_kind === "staff" ? repName(n.author_id) : null;
            return (
              <article key={n.id} className={n.pinned ? "shared-note pinned" : "shared-note"}>
                <div className="shared-note-meta">
                  {n.author_kind === "client" ? (
                    <>
                      <span className="shared-note-avatar client">{initials(clientName)}</span>
                      <span className="shared-note-who">You</span>
                    </>
                  ) : (
                    <>
                      <span className="shared-note-avatar staff">{initials(staffName || companyName)}</span>
                      <span className="shared-note-who">
                        {staffName ? `${staffName} · ${companyName}` : companyName}
                      </span>
                    </>
                  )}
                  {n.kind && (
                    <span className={`shared-note-kind k-${n.kind}`}>{kindLabel(n.kind, "client")}</span>
                  )}
                  <span className="shared-note-spacer" />
                  {n.pinned && <span className="shared-note-pin">📌 Pinned</span>}
                  <span>
                    {when(n.created_at)}
                    {n.edited_at ? " · edited" : ""}
                  </span>
                </div>
                <p className="shared-note-body">{n.body}</p>
                {n.answered_at && (
                  <div className="shared-note-answer">
                    <span className="shared-note-check" aria-hidden="true">
                      ✓
                    </span>
                    <span>
                      Answered by {repName(n.answered_by) || companyName}
                      {n.answer ? `: ${n.answer}` : ""}
                    </span>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      <div className="shared-notes-composer">
        <label htmlFor="portal-new-note" className="shared-notes-composer-label">
          Add a note
        </label>
        <textarea
          id="portal-new-note"
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="e.g. We picked the white quartz sample from Thursday…"
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
            {CLIENT_NOTE_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                className={kind === k ? `shared-notes-kind on k-${k}` : "shared-notes-kind"}
                onClick={() => setKind(k)}
              >
                {kindLabel(k, "client")}
              </button>
            ))}
          </div>
          <button type="button" className="btn-primary" onClick={add} disabled={saving || !body.trim()}>
            {saving ? "Adding…" : "Add note"}
          </button>
        </div>
        <p className="shared-notes-hint">Once added, a note can&apos;t be changed. Our team is notified.</p>
        {error && <p className="error-note">{error}</p>}
      </div>
    </section>
  );
}
