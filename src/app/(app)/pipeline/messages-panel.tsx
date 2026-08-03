"use client";

import { useEffect, useState } from "react";
import { getLeadMessages, sendSms, type LeadMessage } from "@/lib/actions/sms";

// Portal-link emails are logged in the same table so delivery is
// auditable, but they aren't conversation -- shown as a quiet system line
// rather than a chat bubble.
function isSystemEntry(m: LeadMessage) {
  return m.channel === "email";
}

function channelTag(channel: string) {
  if (channel === "portal") return "via portal";
  if (channel === "email") return "email";
  return null;
}

export function MessagesPanel({
  leadId,
  phone,
  readOnly,
}: {
  leadId: string;
  phone: string;
  readOnly?: boolean;
}) {
  const [messages, setMessages] = useState<LeadMessage[] | null>(null);
  const [error, setError] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    // Cancelled on unmount / lead change so a slow response can't write
    // one contact's thread into another's card.
    let cancelled = false;
    (async () => {
      const result = await getLeadMessages(leadId);
      if (cancelled) return;
      if (result.error) {
        setError(result.error);
        setMessages([]);
        return;
      }
      setMessages(result.messages ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [leadId, reloadKey]);

  async function handleSend() {
    const text = body.trim();
    if (!text || !phone) return;
    setSending(true);
    setError("");
    const result = await sendSms(leadId, phone, text);
    setSending(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    setBody("");
    setReloadKey((k) => k + 1);
  }

  return (
    <div className="second-contact-block">
      <div className="second-contact-head">
        <span>Text History</span>
      </div>

      {messages === null ? (
        <p className="empty-hint">Loading…</p>
      ) : messages.length === 0 ? (
        <p className="empty-hint">
          No texts with this contact yet. Messages sent to your own crew about this job aren&apos;t
          shown here — those are recorded on the appointment.
        </p>
      ) : (
        <div className="lead-thread">
          {messages.map((m) =>
            isSystemEntry(m) ? (
              <div key={m.id} className="lead-thread-system">
                {m.body} · {new Date(m.created_at).toLocaleString()}
              </div>
            ) : (
              <div
                key={m.id}
                className={
                  m.direction === "inbound"
                    ? "lead-msg lead-msg-in"
                    : "lead-msg lead-msg-out"
                }
              >
                <div className="lead-msg-body">{m.body}</div>
                <div className="lead-msg-meta">
                  {new Date(m.created_at).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                  {channelTag(m.channel) && <> · {channelTag(m.channel)}</>}
                </div>
              </div>
            )
          )}
        </div>
      )}

      {error && <p className="error-note">{error}</p>}

      {!readOnly && phone && (
        <div style={{ marginTop: 10 }}>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            placeholder={`Text ${phone}…`}
          />
          <div className="modal-actions">
            <div />
            <button
              type="button"
              className="btn-primary small"
              onClick={handleSend}
              disabled={sending || !body.trim()}
            >
              {sending ? "Sending…" : "Send Text"}
            </button>
          </div>
        </div>
      )}
      {!phone && <p className="empty-hint">No phone number on file for this contact.</p>}
    </div>
  );
}
