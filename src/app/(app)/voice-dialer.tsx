"use client";

import { useEffect, useRef, useState } from "react";
import { getVoiceAccessToken } from "@/lib/actions/voice";
import { logCall } from "@/lib/actions/call-logs";
import {
  listCompanyPhoneNumbers,
  type CompanyPhoneNumber,
} from "@/lib/actions/phone-numbers";

type CallStatus = "idle" | "connecting" | "ringing" | "in-call" | "ended" | "error";

const DIAL_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

// Which of the company's numbers this rep shows when calling. Kept on
// the device: caller ID is a per-desk working preference, not profile
// data worth a round trip.
const CALLER_ID_KEY = "crm:dialer-caller-id";

export function VoiceDialer() {
  const [expanded, setExpanded] = useState(false);
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState<CallStatus>("idle");
  const [muted, setMuted] = useState(false);
  const [duration, setDuration] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  // On by default. Recording used to start off, which is why 1 call in 63
  // has audio -- an unticked box is a decision nobody makes.
  const [recordEnabled, setRecordEnabled] = useState(true);
  const [numbers, setNumbers] = useState<CompanyPhoneNumber[]>([]);
  const [callerId, setCallerId] = useState("");

  const deviceRef = useRef<import("@twilio/voice-sdk").Device | null>(null);
  const callRef = useRef<import("@twilio/voice-sdk").Call | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const leadIdRef = useRef<string | null>(null);
  const callSidRef = useRef<string | null>(null);
  const durationRef = useRef(0);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      deviceRef.current?.destroy();
    };
  }, []);

  // The company's numbers, fetched once the dialer is first opened. A
  // remembered pick is honoured only while the company still owns that
  // number; otherwise the default (first in the list) stands.
  const numbersLoadedRef = useRef(false);
  useEffect(() => {
    if (!expanded || numbersLoadedRef.current) return;
    numbersLoadedRef.current = true;
    listCompanyPhoneNumbers().then((list) => {
      setNumbers(list);
      const remembered = window.localStorage.getItem(CALLER_ID_KEY);
      const pick =
        (remembered && list.find((n) => n.phone_number === remembered)) || list[0];
      if (pick) setCallerId(pick.phone_number);
    });
  }, [expanded]);

  function pickCallerId(value: string) {
    setCallerId(value);
    window.localStorage.setItem(CALLER_ID_KEY, value);
  }

  // The Power Dialer page has its own "Calling from" control writing the
  // same key; follow it so the two never show different numbers.
  useEffect(() => {
    function onCallerIdChanged(e: Event) {
      const phone = (e as CustomEvent<{ phone: string }>).detail?.phone;
      if (phone) setCallerId(phone);
    }
    window.addEventListener("crm:caller-id-changed", onCallerIdChanged);
    return () => window.removeEventListener("crm:caller-id-changed", onCallerIdChanged);
  }, []);

  async function ensureDevice() {
    if (deviceRef.current) return deviceRef.current;
    const result = await getVoiceAccessToken();
    if (result.error || !result.token) {
      throw new Error(result.error || "Could not get a call token.");
    }
    const { Device } = await import("@twilio/voice-sdk");
    const device = new Device(result.token, { logLevel: "error" });
    deviceRef.current = device;
    return device;
  }

  function startTimer() {
    setDuration(0);
    durationRef.current = 0;
    timerRef.current = setInterval(() => {
      durationRef.current += 1;
      setDuration(durationRef.current);
    }, 1000);
  }
  function stopTimer() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }

  function finishCall(digits: string, callStatus: string) {
    stopTimer();
    const sid = callSidRef.current;
    const leadId = leadIdRef.current;
    const dur = durationRef.current;
    callRef.current = null;
    callSidRef.current = null;
    leadIdRef.current = null;
    logCall({
      leadId,
      toNumber: digits,
      durationSeconds: dur,
      twilioCallSid: sid,
      status: callStatus,
    }).then((result) => {
      // Fires either way. The dial session waits on this event to unlock its
      // disposition buttons, so swallowing a failed log left the rep staring
      // at a panel that could never be finished -- and never said why.
      window.dispatchEvent(
        new CustomEvent("crm:call-logged", {
          detail: { leadId, callLogId: result.id, error: result.error },
        })
      );
    });
  }

  async function handleCall(overridePhone?: string, leadId?: string | null) {
    const digits = (overridePhone ?? phone).trim();
    if (!digits) {
      setErrorMsg("Enter a phone number to call.");
      return;
    }
    setErrorMsg("");
    setStatus("connecting");
    leadIdRef.current = leadId ?? null;
    callSidRef.current = null;
    // Only startTimer() reset this, and it only runs once a call is answered.
    // A call that rang out was logged with the length of the previous one.
    durationRef.current = 0;
    setDuration(0);
    try {
      const device = await ensureDevice();
      const call = await device.connect({
        params: {
          To: digits,
          Record: recordEnabled ? "true" : "false",
          // Validated server-side against the company's registered
          // numbers; anything else falls back to the default there.
          // localStorage is the fallback because a dial session's first
          // call can arrive before this panel has loaded its list --
          // the pick made on the Power Dialer page must still count.
          ...(callerId || window.localStorage.getItem(CALLER_ID_KEY)
            ? { CallerId: callerId || window.localStorage.getItem(CALLER_ID_KEY)! }
            : {}),
        },
      });
      callRef.current = call;

      call.on("ringing", () => setStatus("ringing"));
      call.on("accept", () => {
        setStatus("in-call");
        callSidRef.current = call.parameters.CallSid ?? null;
        startTimer();
      });
      call.on("disconnect", () => {
        setStatus("ended");
        finishCall(digits, "completed");
      });
      call.on("cancel", () => {
        setStatus("ended");
        finishCall(digits, "cancelled");
      });
      call.on("error", (err: Error) => {
        setErrorMsg(err.message || "Call error.");
        setStatus("error");
        finishCall(digits, "error");
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Could not place the call.");
      setStatus("error");
      // A connect that throws -- no token, no mic, Twilio not set up -- never
      // reached call.on("error"), so nothing was logged and a dial session had
      // no way forward. The attempt still happened; record it as one.
      finishCall(digits, "error");
    }
  }

  useEffect(() => {
    function onCallRequest(e: Event) {
      const detail = (e as CustomEvent<{ phone: string; leadId?: string }>).detail;
      if (!detail?.phone) return;
      setPhone(detail.phone);
      setExpanded(true);
      handleCall(detail.phone, detail.leadId ?? null);
    }
    window.addEventListener("crm:call", onCallRequest);
    return () => window.removeEventListener("crm:call", onCallRequest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleHangup() {
    callRef.current?.disconnect();
    setStatus("ended");
    stopTimer();
  }

  function toggleMute() {
    if (!callRef.current) return;
    const next = !muted;
    callRef.current.mute(next);
    setMuted(next);
  }

  function pressKey(key: string) {
    if (status === "in-call" && callRef.current) {
      callRef.current.sendDigits(key);
    }
    setPhone((p) => p + key);
  }

  const statusLabel: Record<CallStatus, string> = {
    idle: "Ready",
    connecting: "Connecting…",
    ringing: "Ringing…",
    "in-call": `In call — ${String(Math.floor(duration / 60)).padStart(2, "0")}:${String(duration % 60).padStart(2, "0")}`,
    ended: "Call ended",
    error: "Error",
  };

  const busy = status === "connecting" || status === "ringing" || status === "in-call";

  return (
    <div className="voice-dialer-wrap">
      {expanded && (
        <div className="voice-dialer-panel">
          <div className="voice-dialer-head">
            <span>In-App Dialer</span>
            <button className="icon-btn" onClick={() => setExpanded(false)} aria-label="Close dialer">
              ✕
            </button>
          </div>

          <input
            className="voice-dialer-input"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Phone number"
            disabled={busy}
          />

          <div className="voice-dialer-keypad">
            {DIAL_KEYS.map((k) => (
              <button key={k} className="voice-dialer-key" onClick={() => pressKey(k)}>
                {k}
              </button>
            ))}
          </div>

          {/* Only when there is a choice to make -- one number needs no
              switch, and an empty list means the company has not set up
              Twilio numbers at all. */}
          {numbers.length > 1 && (
            <label className="voice-dialer-from">
              Calling from
              <select
                value={callerId}
                onChange={(e) => pickCallerId(e.target.value)}
                disabled={busy}
              >
                {numbers.map((n) => (
                  <option key={n.id} value={n.phone_number}>
                    {(n.label ? n.label + " — " : "") + n.phone_number}
                    {n.is_default ? " (default)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}

          {/* Ticked by default. Unticking stops the recording and the
              notice together -- they are one decision, so a rep can never
              record a homeowner in silence, nor tell them a call is
              recorded when it is not. */}
          {!busy && (
            <label className="voice-dialer-record">
              <input
                type="checkbox"
                checked={recordEnabled}
                onChange={(e) => setRecordEnabled(e.target.checked)}
              />
              Record this call
              <span className="est-tax-note">
                {recordEnabled
                  ? "They hear a recording notice when they answer"
                  : "No recording, and no notice played"}
              </span>
            </label>
          )}

          <div className="voice-dialer-status">{statusLabel[status]}</div>
          {errorMsg && <p className="error-note">{errorMsg}</p>}

          <div className="voice-dialer-actions">
            {busy ? (
              <>
                <button className="btn-ghost" onClick={toggleMute}>
                  {muted ? "Unmute" : "Mute"}
                </button>
                <button className="btn-danger-ghost" onClick={handleHangup}>
                  Hang Up
                </button>
              </>
            ) : (
              <button className="btn-primary" onClick={() => handleCall()}>
                Call
              </button>
            )}
          </div>
        </div>
      )}

      <button
        className={"voice-dialer-fab" + (busy ? " voice-dialer-fab-active" : "")}
        onClick={() => setExpanded((v) => !v)}
        aria-label="Open dialer"
        title="In-App Dialer"
      >
        📞
      </button>
    </div>
  );
}
