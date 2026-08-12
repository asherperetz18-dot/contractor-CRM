"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { leadDisplayName, mapsUrl, type CallDispositionRow, type Lead } from "@/lib/data/types";
import { updateCallDisposition } from "@/lib/actions/call-logs";

export function DialSession({
  leads,
  dispositions,
  callScript,
  onClose,
}: {
  leads: Lead[];
  dispositions: CallDispositionRow[];
  callScript: string | null;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [callLogId, setCallLogId] = useState<string | null>(null);
  const [calling, setCalling] = useState(false);
  const [calledCount, setCalledCount] = useState(0);
  const [ended, setEnded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const lead = leads[index];

  useEffect(() => {
    function onLogged(e: Event) {
      const detail = (e as CustomEvent<{
        leadId: string | null;
        callLogId?: string;
        error?: string;
      }>).detail;
      if (!detail || detail.leadId !== lead?.id) return;
      setCalling(false);
      if (!detail.callLogId) {
        setError(
          detail.error ||
            "That call wasn't logged, so an outcome can't be attached to it. Skip to the next contact."
        );
        return;
      }
      setCallLogId(detail.callLogId);
      setCalledCount((c) => c + 1);
    }
    window.addEventListener("crm:call-logged", onLogged);
    return () => window.removeEventListener("crm:call-logged", onLogged);
  }, [lead?.id]);

  function handleClose() {
    if (!ended && !confirm("End this dialing session?")) return;
    onClose();
  }

  function placeCall() {
    if (!lead?.phone) return;
    setCalling(true);
    setCallLogId(null);
    setError("");
    window.dispatchEvent(
      new CustomEvent("crm:call", { detail: { phone: lead.phone, leadId: lead.id } })
    );
  }

  function advance() {
    setCalling(false);
    setCallLogId(null);
    setError("");
    if (index + 1 >= leads.length) {
      setEnded(true);
    } else {
      setIndex((i) => i + 1);
    }
  }

  async function setDisposition(name: string) {
    if (!callLogId) return;
    setSaving(true);
    // A failed update used to advance anyway, so the rep moved on believing
    // the outcome was saved when nothing had been written.
    const result = await updateCallDisposition(callLogId, name);
    setSaving(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    advance();
  }

  if (ended) {
    return (
      <Modal title="Session Complete" onClose={onClose}>
        <p className="dial-session-name">Nice work.</p>
        <p className="hint-note">
          You made {calledCount} call{calledCount === 1 ? "" : "s"} out of {leads.length} contact
          {leads.length === 1 ? "" : "s"} in this session.
        </p>
        <div className="modal-actions">
          <div />
          <div>
            <button className="btn-primary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Power Dialer Session" onClose={handleClose}>
      <div className="dial-session-progress">
        Contact {index + 1} of {leads.length}
      </div>
      <div className="dial-session-name">{leadDisplayName(lead)}</div>
      <div className="dial-session-phone mono">{lead.phone}</div>

      {lead.address && (
        <p className="hint-note" style={{ marginTop: -8 }}>
          📍{" "}
          <a href={mapsUrl(lead.address)} target="_blank" rel="noopener noreferrer">
            {lead.address}
          </a>
        </p>
      )}

      {callScript && <div className="dial-session-script">{callScript}</div>}

      {!calling && !callLogId ? (
        <button className="btn-primary" style={{ width: "100%", marginBottom: 16 }} onClick={placeCall}>
          📞 Call Now
        </button>
      ) : calling && !callLogId ? (
        <p className="hint-note" style={{ textAlign: "center", marginBottom: 16 }}>
          On the call — set a disposition once you hang up.
        </p>
      ) : (
        <p className="hint-note" style={{ textAlign: "center", marginBottom: 16 }}>
          Call logged — choose an outcome below.
        </p>
      )}

      <div className="dial-session-disposition-grid">
        {dispositions
          .filter((d) => d.name !== "No Disposition")
          .map((d) => (
            <button
              key={d.id}
              className="dial-session-disposition-btn"
              disabled={!callLogId || saving}
              title={callLogId ? undefined : "Place the call first"}
              onClick={() => setDisposition(d.name)}
              style={{ borderColor: callLogId ? d.color + "88" : undefined }}
            >
              {d.name}
            </button>
          ))}
      </div>

      {!callLogId && !calling && (
        <p className="hint-note" style={{ textAlign: "center", marginTop: -8 }}>
          Outcomes unlock once the call is placed — they are saved onto the call itself.
        </p>
      )}
      {error && (
        <p className="error-note" style={{ textAlign: "center" }}>
          {error}
        </p>
      )}

      <div className="dial-session-actions">
        <button className="btn-ghost" onClick={handleClose}>
          End Session
        </button>
        <button className="btn-ghost" onClick={advance}>
          Skip →
        </button>
      </div>
    </Modal>
  );
}
