"use client";

import { useEffect, useState } from "react";
import { repMessagePreview } from "@/lib/data/types";
import {
  getLeadMessages,
  getRepMessages,
  getRepRecipients,
  sendRepMessage,
  sendSms,
  type LeadMessage,
  type RepMessage,
  type RepRecipient,
} from "@/lib/actions/sms";

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
  const [repMessages, setRepMessages] = useState<RepMessage[] | null>(null);
  const [recipients, setRecipients] = useState<RepRecipient[]>([]);
  const [repTo, setRepTo] = useState("");
  const [jobLabel, setJobLabel] = useState("");
  const [tab, setTab] = useState<"client" | "rep">("client");
  const [error, setError] = useState("");
  // Separate drafts per tab. One shared box meant a half-typed note to the
  // customer was still sitting there after switching to Rep, one press
  // away from going to the wrong person entirely.
  const [body, setBody] = useState("");
  const [repBody, setRepBody] = useState("");
  const [sending, setSending] = useState(false);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    // Cancelled on unmount / lead change so a slow response can't write
    // one contact's thread into another's card.
    let cancelled = false;
    (async () => {
      const [result, repResult, whoResult] = await Promise.all([
        getLeadMessages(leadId),
        getRepMessages(leadId),
        getRepRecipients(leadId),
      ]);
      if (cancelled) return;
      if (result.error) {
        setError(result.error);
        setMessages([]);
        setRepMessages([]);
        return;
      }
      setMessages(result.messages ?? []);
      setRepMessages(repResult.messages ?? []);
      const who = whoResult.recipients ?? [];
      setRecipients(who);
      setJobLabel(whoResult.jobLabel ?? "");
      // Whoever is on the next appointment, which is the first entry.
      setRepTo(who[0]?.id ?? "");
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

  /**
   * Texts a teammate about this job.
   *
   * Goes out tagged as crew traffic and stamped with the lead, so it
   * lands in this same Rep record and never in the customer's thread --
   * the same separation the read side already keeps. The job name is
   * added server-side; see sendRepMessage.
   */
  async function handleSendRep() {
    const text = repBody.trim();
    if (!text || !repTo) return;
    setSending(true);
    setError("");
    const result = await sendRepMessage(leadId, repTo, text);
    setSending(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    setRepBody("");
    setReloadKey((k) => k + 1);
  }

  const shown = tab === "client" ? messages : repMessages;
  const repTarget = recipients.find((r) => r.id === repTo) ?? null;

  return (
    <div className="second-contact-block">
      <div className="second-contact-head">
        <span>Text History</span>
        {/* Crew notifications are stamped against the job so they can be
            found, but they are not the customer's conversation -- shown
            side by side rather than mixed, because reading a rep text in
            the customer's thread means believing the customer was told. */}
        <span className="msg-tabs">
          <button
            type="button"
            className={"chip" + (tab === "client" ? " chip-on" : "")}
            onClick={() => setTab("client")}
          >
            Client
          </button>
          <button
            type="button"
            className={"chip" + (tab === "rep" ? " chip-on" : "")}
            onClick={() => setTab("rep")}
          >
            Rep{repMessages && repMessages.length > 0 ? ` (${repMessages.length})` : ""}
          </button>
        </span>
      </div>

      {tab === "rep" && (
        <p className="empty-hint">
          Sent to your own crew about this job — the customer did not receive these.
        </p>
      )}

      {shown === null ? (
        <p className="empty-hint">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="empty-hint">
          {tab === "client"
            ? "No texts with this contact yet. Anything sent to your crew about this job is under Rep."
            : "Nothing has been sent to your crew about this job."}
        </p>
      ) : (
        <div className="lead-thread">
          {shown.map((m) =>
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

      {/* Each tab composes to its own side. The recipient is named on the
          button rather than implied by the tab, because the whole risk
          here is typing to a rep believing the customer will read it. */}
      {tab === "rep" && !readOnly && recipients.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {recipients.length > 1 ? (
            <label className="field">
              <span className="field-label">Send to</span>
              <select value={repTo} onChange={(e) => setRepTo(e.target.value)} disabled={sending}>
                {recipients.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} — {r.role}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="empty-hint">
              To {recipients[0].name} · {recipients[0].role}
            </p>
          )}
          <textarea
            value={repBody}
            onChange={(e) => setRepBody(e.target.value)}
            rows={2}
            placeholder={repTarget ? `Message ${repTarget.name}…` : "Message your crew…"}
          />
          {/* The job name is added for you, so show it. Every text leaves
              from the same company number, which on the rep's phone is one
              long thread across every customer -- without the name, "can
              you go earlier" is unanswerable. */}
          {jobLabel && (
            <p className="hint-note">
              Sends as “{repMessagePreview(jobLabel, repBody || "…").replace(/\n/g, " ⏎ ")}”
            </p>
          )}
          <div className="modal-actions">
            <div />
            <button
              type="button"
              className="btn-primary small"
              onClick={handleSendRep}
              disabled={sending || !repBody.trim() || !repTarget}
            >
              {sending ? "Sending…" : repTarget ? `Send to ${repTarget.name}` : "Send"}
            </button>
          </div>
        </div>
      )}
      {tab === "rep" && !readOnly && recipients.length === 0 && (
        <p className="empty-hint">
          Nobody with a phone number is assigned to this job yet — put a rep on the
          appointment and you can text them from here.
        </p>
      )}

      {tab === "client" && !readOnly && phone && (
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
      {tab === "client" && !phone && (
        <p className="empty-hint">No phone number on file for this contact.</p>
      )}
    </div>
  );
}
