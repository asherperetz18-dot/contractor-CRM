"use client";

import { useEffect, useState, useTransition } from "react";
import {
  getCallDispositions,
  getLeadCalls,
  updateCallDisposition,
  updateCallNotes,
  type LeadCall,
} from "@/lib/actions/call-logs";

function duration(seconds: number) {
  if (!seconds) return "0s";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}

/**
 * Every call with this contact, and the recording where there is one.
 *
 * The recording plays through /api/voice/recording/[id] rather than from
 * Twilio directly: the stored URL only opens with that company's Twilio
 * credentials, and the route checks the session before streaming it.
 *
 * The player is only mounted once someone presses Play. Each one is a
 * live fetch from Twilio, and rendering five of them on open would pull
 * five recordings nobody asked to hear.
 */
export function CallsPanel({ leadId, readOnly }: { leadId: string; readOnly?: boolean }) {
  const [calls, setCalls] = useState<LeadCall[] | null>(null);
  const [dispositions, setDispositions] = useState<string[]>([]);
  const [playing, setPlaying] = useState<Set<string>>(new Set());
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [res, list] = await Promise.all([getLeadCalls(leadId), getCallDispositions()]);
      if (cancelled) return;
      if (res.error) return setError(res.error);
      setCalls(res.calls ?? []);
      setDispositions(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [leadId, reloadKey]);

  // Error first. The other order looks harmless and is not: a failed load
  // never sets `calls`, so the panel sat on "Loading…" for good and the
  // line explaining why was unreachable.
  if (error && !calls) return <p className="error-note">{error}</p>;
  if (!calls) return <p className="empty-hint">Loading…</p>;

  if (calls.length === 0) {
    return (
      <p className="empty-hint">
        No calls with this contact yet. Calls to this contact&rsquo;s number land here however
        they were dialled — from the ☎ button, the calendar, the dial queue or the keypad —
        as do calls they make to the office.
      </p>
    );
  }

  return (
    <div className="second-contact-block">
      <div className="second-contact-head">
        <span>Call History</span>
        <span className="est-tax-note">
          {calls.length} call{calls.length === 1 ? "" : "s"} ·{" "}
          {calls.filter((c) => c.hasRecording).length} recorded
        </span>
      </div>

      <table className="data-table">
        <thead>
          <tr>
            <th>When</th>
            <th>Direction</th>
            <th className="right">Length</th>
            <th>Outcome</th>
          </tr>
        </thead>
        <tbody>
          {calls.map((c) => (
            <tr key={c.id}>
              <td data-label="When">
                {new Date(c.created_at).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
                {c.repName && <div className="est-tax-note">{c.repName}</div>}
                {c.hasRecording && !playing.has(c.id) && (
                  <button
                    className="btn-ghost small"
                    onClick={() => setPlaying((p) => new Set(p).add(c.id))}
                  >
                    ▶ Play recording
                  </button>
                )}
                {playing.has(c.id) && (
                  <audio controls autoPlay src={`/api/voice/recording/${c.id}`} style={{ width: "100%", marginTop: 6 }} />
                )}
                {c.notes && <div className="est-tax-note">“{c.notes}”</div>}
              </td>
              <td data-label="Direction">
                {c.direction === "inbound" ? "Incoming" : "Outgoing"}
                <div className="est-tax-note">{c.status}</div>
              </td>
              <td className="right mono" data-label="Length">
                {duration(c.duration_seconds)}
              </td>
              <td data-label="Outcome">
                {readOnly ? (
                  c.disposition
                ) : (
                  <select
                    value={c.disposition}
                    disabled={pending}
                    onChange={(e) =>
                      startTransition(async () => {
                        const res = await updateCallDisposition(c.id, e.target.value);
                        if (res.error) return setError(res.error);
                        setReloadKey((k) => k + 1);
                      })
                    }
                  >
                    {/* The stored value is included even if it is no longer
                        on the list, so an old disposition is not silently
                        rewritten by opening the dropdown. */}
                    {[...new Set([c.disposition, ...dispositions])].map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                )}
                {!readOnly && (
                  <button
                    className="btn-ghost small"
                    disabled={pending}
                    onClick={() => {
                      setNoteFor(noteFor === c.id ? null : c.id);
                      setNoteText(c.notes ?? "");
                    }}
                  >
                    {c.notes ? "Edit note" : "+ Note"}
                  </button>
                )}
                {noteFor === c.id && (
                  <div style={{ marginTop: 6 }}>
                    <textarea
                      className="est-item-desc"
                      rows={2}
                      value={noteText}
                      disabled={pending}
                      placeholder="What was said"
                      onChange={(e) => setNoteText(e.target.value)}
                    />
                    <button
                      className="btn-primary small"
                      disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          const res = await updateCallNotes(c.id, noteText);
                          if (res.error) return setError(res.error);
                          setNoteFor(null);
                          setReloadKey((k) => k + 1);
                        })
                      }
                    >
                      Save note
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {error && <p className="error-note">{error}</p>}
    </div>
  );
}
