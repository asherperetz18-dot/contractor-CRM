"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  formatTimeRange,
  leadDisplayName,
  mapsUrl,
  type Event,
  type Lead,
  type Profile,
  type SmsMessage,
} from "@/lib/data/types";
import {
  portalRequestReschedule,
  portalSendMessage,
  portalSetAppointmentConfirmed,
  portalSignOut,
  portalUploadFile,
} from "@/lib/actions/portal";

type PortalFile = {
  id: string;
  file_name: string;
  file_url: string | null;
  content_type: string | null;
  created_at: string;
  uploaded_by: string | null;
};

type Tab = "Overview" | "Photos" | "Messages";

// Internal pipeline stages are sales shorthand ("No Answer", "DNC",
// "Close to Sale") and must never be shown to the customer. Everything is
// mapped onto a short, client-safe journey instead.
const JOURNEY = [
  "Request received",
  "Appointment scheduled",
  "Estimate in progress",
  "Proposal sent",
  "Project confirmed",
] as const;

function journeyStep(stage: string): number | null {
  const s = stage.toLowerCase();
  if (s === "lost" || s === "dnc") return null; // show no tracker at all
  if (s === "won") return 4;
  if (s.includes("proposal") || s.includes("finance") || s.includes("close to sale")) return 3;
  if (s.includes("estimate")) return 2;
  if (s.includes("appointment") || s.includes("2nd")) return 1;
  return 0;
}

function formatDate(dateStr: string) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function PortalHome({
  lead,
  events,
  files,
  messages,
  reps,
  companyName,
  companyPhone,
  companyLogo,
}: {
  lead: Lead;
  events: Event[];
  files: PortalFile[];
  messages: SmsMessage[];
  reps: Profile[];
  companyName: string;
  companyPhone: string | null;
  companyLogo: string | null;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("Overview");
  const [busyEvent, setBusyEvent] = useState("");
  const [error, setError] = useState("");
  const [reschedulingFor, setReschedulingFor] = useState("");
  const [rescheduleNote, setRescheduleNote] = useState("");
  const [messageBody, setMessageBody] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);

  const step = journeyStep(lead.stage);
  const todayISO = new Date().toISOString().slice(0, 10);
  const upcoming = events.filter((e) => e.date >= todayISO && e.status !== "Cancelled");
  const past = events.filter((e) => e.date < todayISO || e.status === "Cancelled");

  function repName(id: string | null) {
    if (!id) return null;
    const r = reps.find((x) => x.id === id);
    return r?.name || null;
  }

  async function setConfirmed(eventId: string, confirmed: boolean) {
    setBusyEvent(eventId);
    setError("");
    const result = await portalSetAppointmentConfirmed(eventId, confirmed);
    setBusyEvent("");
    if (result?.error) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  async function submitReschedule(eventId: string) {
    setBusyEvent(eventId);
    setError("");
    const result = await portalRequestReschedule(eventId, rescheduleNote);
    setBusyEvent("");
    if (result?.error) {
      setError(result.error);
      return;
    }
    setReschedulingFor("");
    setRescheduleNote("");
    router.refresh();
  }

  async function sendMessage() {
    if (!messageBody.trim()) return;
    setSending(true);
    setError("");
    const result = await portalSendMessage(messageBody);
    setSending(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    setMessageBody("");
    router.refresh();
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError("");
    const fd = new FormData();
    fd.append("file", file);
    const result = await portalUploadFile(fd);
    setUploading(false);
    e.target.value = "";
    if (result?.error) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="portal-shell">
      <header className="portal-header">
        <div className="portal-header-brand">
          {companyLogo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={companyLogo} alt="" className="portal-logo" />
          )}
          <span className="portal-company">{companyName}</span>
        </div>
        <form action={portalSignOut}>
          <button type="submit" className="btn-ghost small">
            Sign out
          </button>
        </form>
      </header>

      <main className="portal-main">
        <h1 className="portal-greeting">Hi {lead.first_name || leadDisplayName(lead)}</h1>
        {lead.project_type && <p className="portal-subline">{lead.project_type}</p>}

        <nav className="portal-tabs">
          {(["Overview", "Photos", "Messages"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              className={t === tab ? "portal-tab portal-tab-active" : "portal-tab"}
              onClick={() => setTab(t)}
            >
              {t}
              {t === "Photos" && files.length > 0 && ` (${files.length})`}
            </button>
          ))}
        </nav>

        {error && <p className="error-note">{error}</p>}

        {tab === "Overview" && (
          <>
            {step !== null && (
              <section className="portal-card">
                <h2 className="portal-card-title">Project status</h2>
                <ol className="portal-journey">
                  {JOURNEY.map((label, i) => (
                    <li
                      key={label}
                      className={
                        i < step
                          ? "portal-step portal-step-done"
                          : i === step
                            ? "portal-step portal-step-current"
                            : "portal-step"
                      }
                    >
                      <span className="portal-step-dot">{i < step ? "✓" : i + 1}</span>
                      <span className="portal-step-label">{label}</span>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            <section className="portal-card">
              <h2 className="portal-card-title">Upcoming appointments</h2>
              {upcoming.length === 0 ? (
                <p className="portal-empty">
                  Nothing scheduled right now. {companyPhone && `Call us at ${companyPhone} to book.`}
                </p>
              ) : (
                upcoming.map((ev) => (
                  <div key={ev.id} className="portal-appt">
                    <div className="portal-appt-when">
                      <strong>{formatDate(ev.date)}</strong>
                      {ev.time && <span> at {formatTimeRange(ev.time, ev.end_time)}</span>}
                    </div>
                    {repName(ev.assigned_to) && (
                      <div className="portal-appt-rep">With {repName(ev.assigned_to)}</div>
                    )}
                    {lead.address && (
                      <div className="portal-appt-rep">
                        <a href={mapsUrl(lead.address)} target="_blank" rel="noopener noreferrer">
                          {lead.address}
                        </a>
                      </div>
                    )}

                    {ev.customer_confirmed ? (
                      <p className="portal-confirmed">✓ You confirmed this appointment</p>
                    ) : (
                      <div className="portal-appt-actions">
                        <button
                          type="button"
                          className="btn-primary small"
                          disabled={busyEvent === ev.id}
                          onClick={() => setConfirmed(ev.id, true)}
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          className="btn-ghost small"
                          disabled={busyEvent === ev.id}
                          onClick={() =>
                            setReschedulingFor(reschedulingFor === ev.id ? "" : ev.id)
                          }
                        >
                          Request a different time
                        </button>
                      </div>
                    )}

                    {reschedulingFor === ev.id && (
                      <div className="portal-reschedule">
                        <textarea
                          rows={2}
                          value={rescheduleNote}
                          onChange={(e) => setRescheduleNote(e.target.value)}
                          placeholder="What times work better for you?"
                        />
                        <button
                          type="button"
                          className="btn-primary small"
                          disabled={busyEvent === ev.id}
                          onClick={() => submitReschedule(ev.id)}
                        >
                          {busyEvent === ev.id ? "Sending…" : "Send request"}
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </section>

            {past.length > 0 && (
              <section className="portal-card">
                <h2 className="portal-card-title">Past appointments</h2>
                {past.map((ev) => (
                  <div key={ev.id} className="portal-appt portal-appt-past">
                    <div className="portal-appt-when">
                      {formatDate(ev.date)}
                      {ev.time && ` at ${formatTimeRange(ev.time, ev.end_time)}`}
                    </div>
                    {ev.status === "Cancelled" && (
                      <div className="portal-appt-rep">Cancelled</div>
                    )}
                  </div>
                ))}
              </section>
            )}
          </>
        )}

        {tab === "Photos" && (
          <section className="portal-card">
            <h2 className="portal-card-title">Photos &amp; documents</h2>
            <label className="portal-upload">
              <input
                type="file"
                accept="image/*,application/pdf"
                onChange={handleUpload}
                disabled={uploading}
              />
              <span>{uploading ? "Uploading…" : "＋ Add a photo or document"}</span>
            </label>

            {files.length === 0 ? (
              <p className="portal-empty">Nothing shared yet.</p>
            ) : (
              <ul className="portal-files">
                {files.map((f) => (
                  <li key={f.id}>
                    {f.file_url ? (
                      <a href={f.file_url} target="_blank" rel="noopener noreferrer">
                        {f.file_name}
                      </a>
                    ) : (
                      <span>{f.file_name}</span>
                    )}
                    <span className="portal-file-meta">
                      {f.uploaded_by ? "from your contractor" : "you"} ·{" "}
                      {new Date(f.created_at).toLocaleDateString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {tab === "Messages" && (
          <section className="portal-card">
            <h2 className="portal-card-title">Messages</h2>
            {messages.length === 0 ? (
              <p className="portal-empty">No messages yet — send us a note below.</p>
            ) : (
              <div className="portal-thread">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={
                      m.direction === "inbound"
                        ? "portal-msg portal-msg-mine"
                        : "portal-msg portal-msg-them"
                    }
                  >
                    <div className="portal-msg-body">{m.body}</div>
                    <div className="portal-msg-time">
                      {new Date(m.created_at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="portal-composer">
              <textarea
                rows={3}
                value={messageBody}
                onChange={(e) => setMessageBody(e.target.value)}
                placeholder="Write a message…"
              />
              <button
                type="button"
                className="btn-primary"
                onClick={sendMessage}
                disabled={sending || !messageBody.trim()}
              >
                {sending ? "Sending…" : "Send"}
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
