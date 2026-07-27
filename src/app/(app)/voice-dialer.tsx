"use client";

import { useEffect, useRef, useState } from "react";
import { getVoiceAccessToken } from "@/lib/actions/voice";

type CallStatus = "idle" | "connecting" | "ringing" | "in-call" | "ended" | "error";

const DIAL_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

export function VoiceDialer() {
  const [expanded, setExpanded] = useState(false);
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState<CallStatus>("idle");
  const [muted, setMuted] = useState(false);
  const [recordEnabled, setRecordEnabled] = useState(false);
  const [duration, setDuration] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");

  const deviceRef = useRef<import("@twilio/voice-sdk").Device | null>(null);
  const callRef = useRef<import("@twilio/voice-sdk").Call | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      deviceRef.current?.destroy();
    };
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
    timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
  }
  function stopTimer() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }

  async function handleCall(overridePhone?: string) {
    const digits = (overridePhone ?? phone).trim();
    if (!digits) {
      setErrorMsg("Enter a phone number to call.");
      return;
    }
    setErrorMsg("");
    setStatus("connecting");
    try {
      const device = await ensureDevice();
      const call = await device.connect({
        params: { To: digits, Record: recordEnabled ? "true" : "false" },
      });
      callRef.current = call;

      call.on("ringing", () => setStatus("ringing"));
      call.on("accept", () => {
        setStatus("in-call");
        startTimer();
      });
      call.on("disconnect", () => {
        setStatus("ended");
        stopTimer();
        callRef.current = null;
      });
      call.on("cancel", () => {
        setStatus("ended");
        stopTimer();
        callRef.current = null;
      });
      call.on("error", (err: Error) => {
        setErrorMsg(err.message || "Call error.");
        setStatus("error");
        stopTimer();
        callRef.current = null;
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Could not place the call.");
      setStatus("error");
    }
  }

  useEffect(() => {
    function onCallRequest(e: Event) {
      const detail = (e as CustomEvent<{ phone: string }>).detail;
      if (!detail?.phone) return;
      setPhone(detail.phone);
      setExpanded(true);
      handleCall(detail.phone);
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

          {!busy && (
            <label className="voice-dialer-record">
              <input
                type="checkbox"
                checked={recordEnabled}
                onChange={(e) => setRecordEnabled(e.target.checked)}
              />
              Record this call
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
