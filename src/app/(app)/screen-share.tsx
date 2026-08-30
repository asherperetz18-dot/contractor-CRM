"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ui/modal";
import {
  endScreenShare,
  getActiveShares,
  getIceServers,
  getShareTargets,
  startScreenShare,
  type ActiveShare,
} from "@/lib/actions/screen-share";

/**
 * Live screen help between teammates: one shares, one watches, both
 * talk. WebRTC peer-to-peer; the handshake rides a Supabase Realtime
 * channel named by the session's random token, and Twilio's TURN
 * relays cover the networks where peer-to-peer can't punch through.
 *
 * Consent is structural, not policy: the browser's own picker is the
 * only way a screen leaves a machine, and the sharer's Stop -- ours or
 * the browser's -- kills the session for everyone.
 */

const POLL_MS = 20_000;

type Signal =
  | { kind: "viewer-hello" }
  | { kind: "offer"; sdp: RTCSessionDescriptionInit }
  | { kind: "answer"; sdp: RTCSessionDescriptionInit }
  | { kind: "ice"; from: "sharer" | "viewer"; candidate: RTCIceCandidateInit }
  | { kind: "busy" }
  | { kind: "end" };

/** The topbar trigger, mirroring the dialer button's event contract. */
export function ScreenShareButton() {
  const [live, setLive] = useState(false);
  useEffect(() => {
    const onState = (e: Event) =>
      setLive(!!(e as CustomEvent<{ live: boolean }>).detail?.live);
    window.addEventListener("crm:screenshare-state", onState);
    return () => window.removeEventListener("crm:screenshare-state", onState);
  }, []);
  return (
    <button
      type="button"
      className={"icon-btn topbar-icon-btn" + (live ? " topbar-dialer-active" : "")}
      title={live ? "Sharing your screen — click to stop" : "Share my screen with a teammate"}
      aria-label="Share my screen"
      onClick={() => window.dispatchEvent(new CustomEvent("crm:screenshare-toggle"))}
    >
      🖥
    </button>
  );
}

type Channel = ReturnType<ReturnType<typeof createBrowserClient>["channel"]>;

/** A short, quiet chime for a direct invite. Autoplay policy may mute
 * it on a page with no interaction yet -- the popup still shows. */
function ding() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
    osc.onended = () => void ctx.close().catch(() => {});
  } catch {
    // silence is acceptable; the visual invite carries the message
  }
}

export function ScreenShareEngine({
  selfId,
  selfName,
  companyId,
}: {
  selfId: string;
  selfName: string;
  companyId: string;
}) {
  // sharer state
  const [sharing, setSharing] = useState(false);
  const [viewerHere, setViewerHere] = useState(false);
  const [inviteeName, setInviteeName] = useState<string | null>(null);
  // "who should watch?" picker, opened by the topbar button
  const [picker, setPicker] = useState<{ targets: { id: string; name: string }[] | null } | null>(null);
  // viewer state
  const [offer, setOffer] = useState<ActiveShare | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [watching, setWatching] = useState<ActiveShare | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [error, setError] = useState("");

  const supabase = useRef(createBrowserClient());
  const pc = useRef<RTCPeerConnection | null>(null);
  const channel = useRef<Channel | null>(null);
  const shareId = useRef<string | null>(null);
  const screenStream = useRef<MediaStream | null>(null);
  const micStream = useRef<MediaStream | null>(null);
  const remoteAudio = useRef<HTMLAudioElement | null>(null);
  const remoteVideo = useRef<HTMLVideoElement | null>(null);
  const busyRef = useRef(false); // sharer already has a viewer
  // Live mirrors for callbacks that outlive a render (the alert
  // channel below is subscribed once, not per state change).
  const activeRef = useRef(false);
  const dismissedRef = useRef<string | null>(null);
  const dingedRef = useRef<string | null>(null);
  const alertChannel = useRef<Channel | null>(null);

  const broadcast = useCallback((payload: Signal) => {
    channel.current?.send({ type: "broadcast", event: "signal", payload });
  }, []);

  const teardown = useCallback(
    (notify: boolean) => {
      if (notify) broadcast({ kind: "end" });
      pc.current?.close();
      pc.current = null;
      screenStream.current?.getTracks().forEach((t) => t.stop());
      screenStream.current = null;
      micStream.current?.getTracks().forEach((t) => t.stop());
      micStream.current = null;
      if (channel.current) supabase.current.removeChannel(channel.current);
      channel.current = null;
      if (shareId.current) {
        void endScreenShare(shareId.current);
        shareId.current = null;
      }
      busyRef.current = false;
      setSharing(false);
      setViewerHere(false);
      setWatching(null);
      setInviteeName(null);
      window.dispatchEvent(new CustomEvent("crm:screenshare-state", { detail: { live: false } }));
    },
    [broadcast]
  );

  const newPeer = useCallback(async () => {
    const { iceServers } = await getIceServers();
    const peer = new RTCPeerConnection({ iceServers });
    pc.current = peer;
    peer.onconnectionstatechange = () => {
      if (["failed", "closed", "disconnected"].includes(peer.connectionState)) {
        setViewerHere(false);
        busyRef.current = false;
      }
    };
    return peer;
  }, []);

  // ── sharer ──────────────────────────────────────────────────────
  const startSharing = useCallback(async (invitedTo: string | null, inviteeLabel: string | null) => {
    setError("");
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
      let mic: MediaStream | null = null;
      try {
        mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        // no mic is fine -- the screen still shares; talking can go by phone
      }
      const res = await startScreenShare(invitedTo);
      if (res.error || !res.token || !res.id) {
        screen.getTracks().forEach((t) => t.stop());
        mic?.getTracks().forEach((t) => t.stop());
        return setError(res.error ?? "Couldn't start the session.");
      }
      shareId.current = res.id;
      screenStream.current = screen;
      micStream.current = mic;
      setInviteeName(inviteeLabel);

      const ch = supabase.current.channel(`share:${res.token}`);
      channel.current = ch;
      ch.on("broadcast", { event: "signal" }, async ({ payload }) => {
        const sig = payload as Signal;
        const peer = pc.current;
        try {
          if (sig.kind === "viewer-hello") {
            if (busyRef.current) return broadcast({ kind: "busy" });
            busyRef.current = true;
            const p = await newPeer();
            screen.getTracks().forEach((t) => p.addTrack(t, screen));
            mic?.getTracks().forEach((t) => p.addTrack(t, mic));
            p.ontrack = (e) => {
              if (remoteAudio.current) {
                remoteAudio.current.srcObject = e.streams[0];
                void remoteAudio.current.play().catch(() => {});
              }
            };
            p.onicecandidate = (e) => {
              if (e.candidate) broadcast({ kind: "ice", from: "sharer", candidate: e.candidate.toJSON() });
            };
            const offerSdp = await p.createOffer();
            await p.setLocalDescription(offerSdp);
            broadcast({ kind: "offer", sdp: offerSdp });
          } else if (sig.kind === "answer" && peer) {
            await peer.setRemoteDescription(sig.sdp);
            setViewerHere(true);
          } else if (sig.kind === "ice" && sig.from === "viewer" && peer) {
            await peer.addIceCandidate(sig.candidate);
          } else if (sig.kind === "end") {
            pc.current?.close();
            pc.current = null;
            busyRef.current = false;
            setViewerHere(false);
          }
        } catch {
          // a malformed signal must not take down the session
        }
      });
      ch.subscribe();

      // The browser's own Stop-sharing button must end everything too.
      screen.getVideoTracks()[0]?.addEventListener("ended", () => teardown(true));

      setSharing(true);
      window.dispatchEvent(new CustomEvent("crm:screenshare-state", { detail: { live: true } }));

      // The knock on the door: teammates' engines listen on the
      // company alert channel and pull the fresh session immediately,
      // instead of waiting out the discovery poll.
      alertChannel.current?.send({
        type: "broadcast",
        event: "invite",
        payload: { invitedTo, sharerName: selfName },
      });
    } catch {
      // user cancelled the picker
    }
  }, [broadcast, newPeer, teardown, selfName]);

  // ── viewer ──────────────────────────────────────────────────────
  const startWatching = useCallback(
    async (share: ActiveShare) => {
      setError("");
      setOffer(null);
      let mic: MediaStream | null = null;
      try {
        mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        // watch-only is still useful
      }
      micStream.current = mic;

      const peer = await newPeer();
      mic?.getTracks().forEach((t) => peer.addTrack(t, mic));
      peer.ontrack = (e) => {
        if (e.track.kind === "video" && remoteVideo.current) {
          remoteVideo.current.srcObject = e.streams[0];
          void remoteVideo.current.play().catch(() => {});
        }
        if (e.track.kind === "audio" && remoteAudio.current) {
          remoteAudio.current.srcObject = e.streams[0];
          void remoteAudio.current.play().catch(() => {});
        }
      };
      peer.onicecandidate = (e) => {
        if (e.candidate) broadcast({ kind: "ice", from: "viewer", candidate: e.candidate.toJSON() });
      };

      const ch = supabase.current.channel(`share:${share.token}`);
      channel.current = ch;
      ch.on("broadcast", { event: "signal" }, async ({ payload }) => {
        const sig = payload as Signal;
        try {
          if (sig.kind === "offer") {
            await peer.setRemoteDescription(sig.sdp);
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            broadcast({ kind: "answer", sdp: answer });
          } else if (sig.kind === "ice" && sig.from === "sharer") {
            await peer.addIceCandidate(sig.candidate);
          } else if (sig.kind === "busy") {
            setError(`${share.sharerName} already has a viewer in this session.`);
            teardown(false);
          } else if (sig.kind === "end") {
            teardown(false);
          }
        } catch {
          // ignore malformed signals
        }
      });
      ch.subscribe((status) => {
        if (status === "SUBSCRIBED") broadcast({ kind: "viewer-hello" });
      });
      setWatching(share);
    },
    [broadcast, newPeer, teardown]
  );

  // toggle from the topbar button: sharing stops; otherwise ask WHO
  // should watch before anything leaves this machine.
  useEffect(() => {
    const onToggle = () => {
      if (sharing) teardown(true);
      else if (!watching) {
        setPicker({ targets: null });
        void getShareTargets().then((res) => {
          setPicker((p) => (p ? { targets: res.targets ?? [] } : p));
        });
      }
    };
    window.addEventListener("crm:screenshare-toggle", onToggle);
    return () => window.removeEventListener("crm:screenshare-toggle", onToggle);
  }, [sharing, watching, teardown]);

  // Mirrors for the once-subscribed alert channel below.
  useEffect(() => {
    activeRef.current = sharing || !!watching;
  }, [sharing, watching]);
  useEffect(() => {
    dismissedRef.current = dismissed;
  }, [dismissed]);

  const refreshOffers = useCallback(async () => {
    if (activeRef.current) return;
    const res = await getActiveShares().catch(() => null);
    if (!res?.shares || activeRef.current) return;
    // A share aimed at me outranks an open one; RLS already hides
    // shares aimed at somebody else.
    const mine = res.shares.find((s) => s.sharerId !== selfId && s.invitedTo === selfId);
    const open = res.shares.find((s) => s.sharerId !== selfId && !s.invitedTo);
    const pick = mine ?? open ?? null;
    setOffer(pick && pick.id !== dismissedRef.current ? pick : null);
    // The chime rings once per targeted session, not once per poll.
    if (mine && mine.id !== dismissedRef.current && dingedRef.current !== mine.id) {
      dingedRef.current = mine.id;
      ding();
    }
  }, [selfId]);

  // discovery poll for the viewer banner
  useEffect(() => {
    if (sharing || watching) return;
    void refreshOffers();
    const t = setInterval(() => void refreshOffers(), POLL_MS);
    return () => clearInterval(t);
  }, [sharing, watching, dismissed, refreshOffers]);

  // The company alert channel: a starting sharer knocks here, and
  // every idle engine checks for the new session right away instead of
  // waiting out the poll. Subscribed once per mount.
  useEffect(() => {
    const ch = supabase.current.channel(`share-alert:${companyId}`);
    ch.on("broadcast", { event: "invite" }, ({ payload }) => {
      const p = payload as { invitedTo: string | null };
      if (p.invitedTo && p.invitedTo !== selfId) return;
      void refreshOffers();
    });
    ch.subscribe();
    alertChannel.current = ch;
    const client = supabase.current;
    return () => {
      void client.removeChannel(ch);
      alertChannel.current = null;
    };
  }, [companyId, selfId, refreshOffers]);

  // closing the tab must not leave a ghost "live" session behind
  useEffect(() => {
    const bye = () => teardown(true);
    window.addEventListener("beforeunload", bye);
    return () => {
      window.removeEventListener("beforeunload", bye);
      teardown(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleMic() {
    setMicOn((on) => {
      micStream.current?.getAudioTracks().forEach((t) => {
        t.enabled = !on;
      });
      return !on;
    });
  }

  return (
    <>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={remoteAudio} autoPlay style={{ display: "none" }} />

      {picker && !sharing && !watching && (
        <Modal title="Share your screen" onClose={() => setPicker(null)}>
          <p className="module-sub" style={{ marginTop: 0 }}>
            Who should watch? A teammate you pick gets pinged right away — and nobody else
            even sees the session.
          </p>
          {picker.targets === null ? (
            <p className="empty-hint">Loading your team…</p>
          ) : (
            <div className="ss-picker-list">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setPicker(null);
                  void startSharing(null, null);
                }}
              >
                🌐 Anyone on the team
              </button>
              {picker.targets.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    setPicker(null);
                    void startSharing(t.id, t.name);
                  }}
                >
                  👤 {t.name}
                </button>
              ))}
            </div>
          )}
        </Modal>
      )}

      {sharing && (
        <div className="ss-pill">
          <span className="ss-dot" />
          Sharing your screen
          {viewerHere
            ? ` — ${inviteeName ?? "a teammate"} is watching`
            : ` — waiting for ${inviteeName ?? "a teammate"}`}
          <button className="btn-ghost small" onClick={toggleMic}>
            {micOn ? "🎙 Mic on" : "🔇 Mic off"}
          </button>
          <button className="btn-primary small" onClick={() => teardown(true)}>
            Stop
          </button>
        </div>
      )}

      {offer && !sharing && !watching && offer.invitedTo === selfId ? (
        // A direct invite is a knock, not a notice -- centered, named,
        // and impossible to miss.
        <Modal
          title="Screen share invite"
          onClose={() => {
            setDismissed(offer.id);
            setOffer(null);
          }}
        >
          <p style={{ marginTop: 0 }}>
            🖥 <strong>{offer.sharerName}</strong> wants to share their screen with you.
          </p>
          <div className="modal-actions">
            <button
              className="btn-ghost"
              onClick={() => {
                setDismissed(offer.id);
                setOffer(null);
              }}
            >
              Not now
            </button>
            <button className="btn-primary" onClick={() => void startWatching(offer)}>
              Join
            </button>
          </div>
        </Modal>
      ) : offer && !sharing && !watching ? (
        <div className="ss-banner">
          🖥 <strong>{offer.sharerName}</strong> is sharing their screen
          <button className="btn-primary small" onClick={() => void startWatching(offer)}>
            Watch
          </button>
          <button
            className="icon-btn"
            aria-label="Dismiss"
            onClick={() => {
              setDismissed(offer.id);
              setOffer(null);
            }}
          >
            ✕
          </button>
        </div>
      ) : null}

      {watching && (
        <div className="ss-viewer" role="dialog" aria-label="Screen share">
          <div className="ss-viewer-head">
            <span>
              <span className="ss-dot" /> Watching <strong>{watching.sharerName}</strong>&apos;s screen
            </span>
            <div className="ss-viewer-tools">
              <button className="btn-ghost small" onClick={toggleMic}>
                {micOn ? "🎙 Mic on" : "🔇 Mic off"}
              </button>
              <button
                className="btn-primary small"
                onClick={() => {
                  broadcast({ kind: "end" });
                  teardown(false);
                }}
              >
                Leave
              </button>
            </div>
          </div>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video ref={remoteVideo} autoPlay playsInline className="ss-video" />
        </div>
      )}

      {error && (
        <div className="ss-banner">
          {error}
          <button className="icon-btn" aria-label="Dismiss" onClick={() => setError("")}>
            ✕
          </button>
        </div>
      )}
    </>
  );
}
