"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Field } from "@/components/ui/field";
import {
  leadDisplayName,
  mapsUrl,
  type CallDispositionRow,
  type Lead,
  type Profile,
} from "@/lib/data/types";
import { updateCallDisposition } from "@/lib/actions/call-logs";
import { bookAppointmentForLead } from "@/lib/actions/leads";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function DialSession({
  leads,
  dispositions,
  reps,
  callScript,
  onClose,
}: {
  leads: Lead[];
  dispositions: CallDispositionRow[];
  /** For the quick-booking step when an outcome sets an appointment. */
  reps: Profile[];
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
  /**
   * An outcome picked while still on the call.
   *
   * The buttons used to stay locked until the call ended and logged, so
   * the rep sat through the goodbye staring at a grey panel -- and if
   * the log never arrived, at one that never woke up. Picking early
   * stages the choice here; the moment the log lands it saves itself.
   * A ref shadows it because the save fires from the call-logged event
   * listener, which would otherwise close over a stale value.
   */
  const [chosen, setChosen] = useState<string | null>(null);
  const chosenRef = useRef<string | null>(null);
  /** Quick appointment booking, shown after an appointment-setting outcome. */
  const [booking, setBooking] = useState<{ date: string; time: string; assignedTo: string } | null>(
    null
  );
  const [bookingPending, setBookingPending] = useState(false);
  /**
   * Dial the next contact by itself once an outcome is recorded.
   *
   * With a visible countdown and a pause, never instantly: the rep needs
   * a breath between conversations, and a train that cannot be stopped
   * teaches people to close the whole session instead. Only fires after
   * an outcome -- Skip stays manual, because skipping is how a rep
   * browses the queue.
   */
  const [autoDial, setAutoDial] = useState(true);
  const [countdown, setCountdown] = useState<number | null>(null);

  const lead = leads[index];

  useEffect(() => {
    if (countdown === null) return;
    const t = setTimeout(() => {
      if (countdown <= 1) {
        setCountdown(null);
        if (lead?.phone) placeCall();
      } else {
        setCountdown(countdown - 1);
      }
    }, 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown]);

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
      // The rep already said what happened -- finish the job for them.
      if (chosenRef.current) void commit(detail.callLogId, chosenRef.current);
    }
    window.addEventListener("crm:call-logged", onLogged);
    return () => window.removeEventListener("crm:call-logged", onLogged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead?.id]);

  function handleClose() {
    if (!ended && !confirm("End this dialing session?")) return;
    onClose();
  }

  function placeCall() {
    if (!lead?.phone) return;
    setCalling(true);
    setCallLogId(null);
    setChosen(null);
    chosenRef.current = null;
    setError("");
    window.dispatchEvent(
      new CustomEvent("crm:call", { detail: { phone: lead.phone, leadId: lead.id } })
    );
  }

  function advance(autoNext = false) {
    setCalling(false);
    setCallLogId(null);
    setChosen(null);
    chosenRef.current = null;
    setBooking(null);
    setCountdown(null);
    setError("");
    if (index + 1 >= leads.length) {
      setEnded(true);
      return;
    }
    setIndex((i) => i + 1);
    if (autoNext && autoDial) setCountdown(3);
  }

  async function commit(logId: string, name: string) {
    setSaving(true);
    // A failed update used to advance anyway, so the rep moved on believing
    // the outcome was saved when nothing had been written.
    const result = await updateCallDisposition(logId, name);
    setSaving(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    // An outcome that schedules an appointment should end with one on
    // the calendar. The stage has already moved; leaving without the
    // booking is what puts "Appointment Scheduled" leads on the board
    // with nothing behind them.
    const dispo = dispositions.find((d) => d.name === name);
    if (dispo?.move_to_stage === "Appointment Scheduled") {
      setBooking({ date: todayISO(), time: "09:00", assignedTo: "" });
      return;
    }
    advance(true);
  }

  function pickDisposition(name: string) {
    if (saving) return;
    if (callLogId) {
      void commit(callLogId, name);
      return;
    }
    // Still on the call: stage it, and let the hang-up save it.
    setChosen(name);
    chosenRef.current = name;
  }

  async function handleBook() {
    if (!lead || !booking) return;
    if (!booking.assignedTo) {
      setError("Pick who is running the appointment.");
      return;
    }
    setBookingPending(true);
    setError("");
    const result = await bookAppointmentForLead(lead.id, lead.stage, {
      title: "",
      date: booking.date,
      time: booking.time,
      eventType: "Estimate",
      assignedTo: booking.assignedTo,
    });
    setBookingPending(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    advance(true);
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

  if (booking && lead) {
    return (
      <Modal title="Book the Appointment" onClose={handleClose}>
        <div className="dial-session-name">{leadDisplayName(lead)}</div>
        <p className="hint-note">
          The outcome is saved and the lead has moved to Appointment Scheduled. Put the visit on
          the calendar now, so the stage and the schedule agree.
        </p>
        <Field label="Date">
          <input
            type="date"
            value={booking.date}
            min={todayISO()}
            onChange={(e) => setBooking((b) => b && { ...b, date: e.target.value })}
          />
        </Field>
        <Field label="Time">
          <input
            type="time"
            value={booking.time}
            onChange={(e) => setBooking((b) => b && { ...b, time: e.target.value })}
          />
        </Field>
        <Field label="Assigned To">
          <select
            value={booking.assignedTo}
            onChange={(e) => setBooking((b) => b && { ...b, assignedTo: e.target.value })}
          >
            <option value="">— choose —</option>
            {reps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name || r.email}
              </option>
            ))}
          </select>
        </Field>
        {error && <p className="error-note">{error}</p>}
        <div className="modal-actions">
          <button className="btn-ghost" onClick={() => advance(false)}>
            Skip booking
          </button>
          <button className="btn-primary" onClick={handleBook} disabled={bookingPending}>
            {bookingPending ? "Booking…" : "Book & Next →"}
          </button>
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

      {countdown !== null ? (
        <div className="dial-countdown">
          <span>
            📞 Calling <strong>{leadDisplayName(lead)}</strong> in {countdown}…
          </span>
          <button className="btn-ghost" onClick={() => setCountdown(null)}>
            Pause
          </button>
        </div>
      ) : !calling && !callLogId ? (
        <button className="btn-primary" style={{ width: "100%", marginBottom: 16 }} onClick={placeCall}>
          📞 Call Now
        </button>
      ) : calling && !callLogId ? (
        <p className="hint-note" style={{ textAlign: "center", marginBottom: 16 }}>
          {chosen
            ? `"${chosen}" selected — it saves when you hang up.`
            : "On the call — pick the outcome whenever you know it."}
        </p>
      ) : (
        <p className="hint-note" style={{ textAlign: "center", marginBottom: 16 }}>
          Call logged — choose an outcome below.
        </p>
      )}

      <div className="dial-session-disposition-grid">
        {dispositions
          .filter((d) => d.name !== "No Disposition")
          .map((d) => {
            const active = calling || !!callLogId;
            return (
              <button
                key={d.id}
                className={
                  "dial-session-disposition-btn" + (chosen === d.name ? " dial-chosen" : "")
                }
                disabled={!active || saving}
                title={active ? undefined : "Place the call first"}
                onClick={() => pickDisposition(d.name)}
                style={{ borderColor: active ? d.color + "88" : undefined }}
              >
                {d.name}
              </button>
            );
          })}
      </div>

      {!callLogId && !calling && (
        <p className="hint-note" style={{ textAlign: "center", marginTop: -8 }}>
          Outcomes unlock when you dial. They save onto the call, and can move the lead on the
          pipeline — set per outcome in Settings → Call Dispositions.
        </p>
      )}
      {error && (
        <p className="error-note" style={{ textAlign: "center" }}>
          {error}
        </p>
      )}

      <label className="dial-auto-toggle">
        <input
          type="checkbox"
          checked={autoDial}
          onChange={(e) => {
            setAutoDial(e.target.checked);
            if (!e.target.checked) setCountdown(null);
          }}
        />
        Auto-dial the next contact after each outcome
      </label>

      <div className="dial-session-actions">
        <button className="btn-ghost" onClick={handleClose}>
          End Session
        </button>
        <button className="btn-ghost" onClick={() => advance(false)}>
          Skip →
        </button>
      </div>
    </Modal>
  );
}
