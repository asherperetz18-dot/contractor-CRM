"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ui/modal";
import {
  endScreenShare,
  getActiveShares,
  getIceServers,
  getShareTargets,
  requestScreenShare,
  startScreenShare,
  type ActiveShare,
} from "@/lib/actions/screen-share";

/**
 * Live screen help between teammates: one shares, one watches, both
 * talk -- and it can go both ways: either can turn a camera on to be
 * seen in a corner bubble, and the viewer can share their own screen
 * back so each side watches the other's. WebRTC peer-to-peer; the
 * handshake rides a Supabase Realtime channel named by the session's
 * random token, and Twilio's TURN relays cover the networks where
 * peer-to-peer can't punch through.
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
  | { kind: "cam"; from: "sharer" | "viewer"; on: boolean }
  | { kind: "share-back"; on: boolean }
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
      {/* Drawn, not typed: the 🖥 emoji renders as a muddy dark slab on
          Windows. A monitor with an outgoing arrow both reads at 16px
          and says "share", not just "screen". */}
      <svg
        width="19"
        height="19"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <rect x="2" y="4" width="20" height="13" rx="2" fill="#e3edf9" stroke="#2b5c9e" strokeWidth="1.8" />
        <path d="M8.5 21h7M12 17.2V21" stroke="#2b5c9e" strokeWidth="1.8" strokeLinecap="round" />
        <path
          d="M12 13.2V8.2M9.6 10.4L12 8l2.4 2.4"
          stroke="#2b5c9e"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

/** Admin-only topbar trigger: ask a teammate to show THEIR screen.
 * Rendered only for admins in the layout; the server action rejects
 * the ask from anyone else, so the browser console can't route around
 * it either. */
export function RequestScreenButton() {
  return (
    <button
      type="button"
      className="icon-btn topbar-icon-btn"
      title="Ask a teammate to show you their screen"
      aria-label="Request a teammate's screen"
      onClick={() => window.dispatchEvent(new CustomEvent("crm:screenshare-request"))}
    >
      {/* A monitor with an eye: "let me see yours", the mirror image of
          the share button's outgoing arrow. */}
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <rect x="2" y="4" width="20" height="13" rx="2" fill="#e3edf9" stroke="#2b5c9e" strokeWidth="1.8" />
        <path d="M8.5 21h7M12 17.2V21" stroke="#2b5c9e" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="12" cy="10.5" r="1.7" fill="#2b5c9e" />
        <path
          d="M7.5 10.5C8.8 8.4 10.3 7.5 12 7.5s3.2.9 4.5 3c-1.3 2.1-2.8 3-4.5 3s-3.2-.9-4.5-3Z"
          stroke="#2b5c9e"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

type Channel = ReturnType<ReturnType<typeof createBrowserClient>["channel"]>;

/** Short, quiet chimes. The person they're aimed at is usually looking
 * at a different window entirely -- sound is the only channel that
 * still reaches them. Autoplay policy may mute one on a page with no
 * interaction yet; every chime has a visual twin, so silence is safe. */
function chime(notes: number[]) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      const t0 = ctx.currentTime + i * 0.17;
      gain.gain.setValueAtTime(0.08, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4);
      osc.start(t0);
      osc.stop(t0 + 0.45);
    });
    window.setTimeout(() => void ctx.close().catch(() => {}), notes.length * 170 + 600);
  } catch {
    // silence is acceptable; the visual state carries the message
  }
}
/** a direct invite landed */
const ding = () => chime([880]);
/** rising: they answered -- your screen has an audience now */
const dingAnswered = () => chime([523.25, 783.99]);
/** falling: they left -- you're sharing to nobody, consider Stop */
const dingLeft = () => chime([659.25, 392]);

export function ScreenShareEngine({
  selfId,
  selfName,
  companyId,
  isAdmin = false,
}: {
  selfId: string;
  selfName: string;
  companyId: string;
  /** Admins can ask a teammate to show their screen (the request flow);
   *  everyone can share their own. */
  isAdmin?: boolean;
}) {
  // sharer state
  const [sharing, setSharing] = useState(false);
  const [viewerHere, setViewerHere] = useState(false);
  const [inviteeName, setInviteeName] = useState<string | null>(null);
  // The picker, opened by a topbar button. mode "share" = "who should
  // watch my screen?"; mode "request" = "whose screen do I want to see?"
  const [picker, setPicker] = useState<{
    targets: { id: string; name: string }[] | null;
    mode: "share" | "request";
  } | null>(null);
  // admin waiting on a teammate to answer a screen request
  const [requesting, setRequesting] = useState<{ id: string; name: string } | null>(null);
  // teammate's incoming "show me your screen" popup
  const [incomingRequest, setIncomingRequest] = useState<{ fromId: string; fromName: string } | null>(null);
  // viewer state
  const [offer, setOffer] = useState<ActiveShare | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [watching, setWatching] = useState<ActiveShare | null>(null);
  const [micOn, setMicOn] = useState(true);
  // cameras: off until somebody turns theirs on, each side separately
  const [camOn, setCamOn] = useState(false);
  const [remoteCamOn, setRemoteCamOn] = useState(false);
  // the viewer sharing their own screen back at the sharer
  const [shareBackOn, setShareBackOn] = useState(false);
  const [remoteShareBack, setRemoteShareBack] = useState(false);
  // where the user dragged the status pill; null = its default spot
  const [pillPos, setPillPos] = useState<{ x: number; y: number } | null>(null);
  // same for the corner screen window (only one shows at a time)
  const [panelPos, setPanelPos] = useState<{ x: number; y: number } | null>(null);
  const [error, setError] = useState("");

  const supabase = useRef(createBrowserClient());
  const pc = useRef<RTCPeerConnection | null>(null);
  const channel = useRef<Channel | null>(null);
  const shareId = useRef<string | null>(null);
  const screenStream = useRef<MediaStream | null>(null);
  const micStream = useRef<MediaStream | null>(null);
  const remoteAudio = useRef<HTMLAudioElement | null>(null);
  const remoteVideo = useRef<HTMLVideoElement | null>(null);
  const camStream = useRef<MediaStream | null>(null);
  const camSender = useRef<RTCRtpSender | null>(null);
  const camVideo = useRef<HTMLVideoElement | null>(null);
  const shareBackStream = useRef<MediaStream | null>(null);
  const shareBackSender = useRef<RTCRtpSender | null>(null);
  const backVideo = useRef<HTMLVideoElement | null>(null);
  const pillDrag = useRef<{ dx: number; dy: number } | null>(null);
  const panelDrag = useRef<{ dx: number; dy: number } | null>(null);
  const busyRef = useRef(false); // sharer already has a viewer
  // Live mirrors for callbacks that outlive a render (the alert
  // channel below is subscribed once, not per state change).
  const activeRef = useRef(false);
  const dismissedRef = useRef<string | null>(null);
  const dingedRef = useRef<string | null>(null);
  const alertChannel = useRef<Channel | null>(null);
  // the teammate an admin is waiting on; when that person's share
  // appears, the admin joins it without a prompt (they asked for it)
  const awaitingFromRef = useRef<string | null>(null);
  // A request is a broadcast, not a DB row, so a single send is lost if
  // the teammate's tab happened to be between pages or asleep. These
  // re-send it on a beat and give up after a while instead of hanging.
  const requestRetry = useRef<ReturnType<typeof setInterval> | null>(null);
  const requestTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  // which asker we've already chimed for, so the re-sent pings don't
  // ring the teammate's popup over and over
  const requestDinged = useRef<string | null>(null);

  const broadcast = useCallback((payload: Signal) => {
    channel.current?.send({ type: "broadcast", event: "signal", payload });
  }, []);

  // The optional lanes (faces, the viewer's screen-back) live and die
  // with one peer connection: a viewer leaving, or the whole session
  // ending, puts them all back to off.
  const resetLanes = useCallback(() => {
    camStream.current?.getTracks().forEach((t) => t.stop());
    camStream.current = null;
    camSender.current = null;
    shareBackStream.current?.getTracks().forEach((t) => t.stop());
    shareBackStream.current = null;
    shareBackSender.current = null;
    setCamOn(false);
    setRemoteCamOn(false);
    setShareBackOn(false);
    setRemoteShareBack(false);
  }, []);

  const teardown = useCallback(
    (notify: boolean) => {
      if (notify) broadcast({ kind: "end" });
      resetLanes();
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
      setPillPos(null);
      setPanelPos(null);
      setRequesting(null);
      setIncomingRequest(null);
      awaitingFromRef.current = null;
      requestDinged.current = null;
      if (requestRetry.current) clearInterval(requestRetry.current);
      if (requestTimeout.current) clearTimeout(requestTimeout.current);
      requestRetry.current = null;
      requestTimeout.current = null;
      window.dispatchEvent(new CustomEvent("crm:screenshare-state", { detail: { live: false } }));
    },
    [broadcast, resetLanes]
  );

  const newPeer = useCallback(async () => {
    const { iceServers } = await getIceServers();
    const peer = new RTCPeerConnection({ iceServers });
    pc.current = peer;
    peer.onconnectionstatechange = () => {
      if (["failed", "closed", "disconnected"].includes(peer.connectionState)) {
        // busyRef is only ever true on the sharer: a drop with no
        // goodbye (closed laptop, dead wifi) still rings the
        // you're-alone-now tone there, and stays silent for a viewer
        // who is looking at the failure anyway
        if (busyRef.current) dingLeft();
        setViewerHere(false);
        busyRef.current = false;
        resetLanes();
      }
    };
    return peer;
  }, [resetLanes]);

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
            // Two extra video lanes are negotiated up front, empty:
            // one for faces, one for the viewer's screen coming back.
            // Turning either on later is replaceTrack, no SDP
            // round-trip. M-line order is the contract both ends read:
            // screen first, camera second, screen-back third.
            camSender.current = p.addTransceiver("video", { direction: "sendrecv" }).sender;
            p.addTransceiver("video", { direction: "sendrecv" });
            p.ontrack = (e) => {
              if (e.track.kind === "video") {
                const vids = p.getTransceivers().filter((t) => t.receiver.track.kind === "video");
                // lane 3 is the viewer's screen; lane 2 their face
                const el = e.transceiver === vids[2] ? backVideo.current : camVideo.current;
                if (el) {
                  el.srcObject = new MediaStream([e.track]);
                  void el.play().catch(() => {});
                }
              } else if (remoteAudio.current) {
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
            // the "they picked up" ring: the sharer started this call
            // minutes ago and is deep in some other window by now
            dingAnswered();
          } else if (sig.kind === "ice" && sig.from === "viewer" && peer) {
            await peer.addIceCandidate(sig.candidate);
          } else if (sig.kind === "cam" && sig.from === "viewer") {
            setRemoteCamOn(sig.on);
          } else if (sig.kind === "share-back") {
            setRemoteShareBack(sig.on);
          } else if (sig.kind === "end") {
            pc.current?.close();
            pc.current = null;
            busyRef.current = false;
            setViewerHere(false);
            resetLanes();
            // they hung up but this screen is STILL being shared --
            // the falling tone is the nudge to come back and Stop
            dingLeft();
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
  }, [broadcast, newPeer, teardown, resetLanes, selfName]);

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
        if (e.track.kind === "video") {
          // Video lanes arrive in the offer's order -- screen first,
          // camera second, screen-back third. Position tells them
          // apart; the third lane only carries video AWAY from here.
          const vids = peer.getTransceivers().filter((t) => t.receiver.track.kind === "video");
          if (e.transceiver === vids[1]) {
            if (camVideo.current) {
              camVideo.current.srcObject = new MediaStream([e.track]);
              void camVideo.current.play().catch(() => {});
            }
          } else if (e.transceiver === vids[0] && remoteVideo.current) {
            remoteVideo.current.srcObject = e.streams[0];
            void remoteVideo.current.play().catch(() => {});
          }
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
            // claim the lanes the sharer negotiated: the second video
            // m-line carries this side's face, the third this side's
            // own screen going back
            const vids = peer.getTransceivers().filter((t) => t.receiver.track.kind === "video");
            const camTx = vids[1];
            if (camTx) {
              camTx.direction = "sendrecv";
              camSender.current = camTx.sender;
            }
            const backTx = vids[2];
            if (backTx) {
              backTx.direction = "sendrecv";
              shareBackSender.current = backTx.sender;
            }
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            broadcast({ kind: "answer", sdp: answer });
          } else if (sig.kind === "ice" && sig.from === "sharer") {
            await peer.addIceCandidate(sig.candidate);
          } else if (sig.kind === "cam" && sig.from === "sharer") {
            setRemoteCamOn(sig.on);
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

  // ── admin: request a teammate's screen ──────────────────────────
  const clearRequestTimers = useCallback(() => {
    if (requestRetry.current) clearInterval(requestRetry.current);
    if (requestTimeout.current) clearTimeout(requestTimeout.current);
    requestRetry.current = null;
    requestTimeout.current = null;
  }, []);

  // The ask itself carries no pixels: it just pings the teammate, whose
  // "Share now" starts the session aimed back here. awaitingFromRef
  // arms the auto-join for when that session appears. The ping is a
  // broadcast (no DB row), so we re-send it every few seconds until
  // they answer -- catching a tab that was mid-navigation or asleep the
  // instant we first sent -- and give up after 40s rather than hang.
  const requestScreen = useCallback(
    async (targetId: string, targetName: string) => {
      setError("");
      const res = await requestScreenShare(targetId);
      if (res.error || !res.ok) return setError(res.error ?? "Couldn't send the request.");
      awaitingFromRef.current = targetId;
      setRequesting({ id: targetId, name: targetName });
      clearRequestTimers();
      const ping = () =>
        alertChannel.current?.send({
          type: "broadcast",
          event: "request",
          payload: { fromId: selfId, fromName: selfName, to: targetId },
        });
      ping();
      requestRetry.current = setInterval(ping, 3000);
      requestTimeout.current = setTimeout(() => {
        clearRequestTimers();
        awaitingFromRef.current = null;
        setRequesting(null);
        alertChannel.current?.send({ type: "broadcast", event: "request-cancel", payload: { to: targetId } });
        setError(`${targetName} didn't answer. Make sure their CRM is open, then try again.`);
      }, 40_000);
    },
    [selfId, selfName, clearRequestTimers]
  );

  const cancelRequest = useCallback(() => {
    const target = awaitingFromRef.current;
    clearRequestTimers();
    awaitingFromRef.current = null;
    setRequesting(null);
    if (target) {
      alertChannel.current?.send({ type: "broadcast", event: "request-cancel", payload: { to: target } });
    }
  }, [clearRequestTimers]);

  const declineRequest = useCallback(() => {
    requestDinged.current = null;
    setIncomingRequest((req) => {
      if (req) {
        alertChannel.current?.send({
          type: "broadcast",
          event: "request-declined",
          payload: { to: req.fromId, fromName: selfName },
        });
      }
      return null;
    });
  }, [selfName]);

  // toggle from the topbar button: sharing stops; otherwise ask WHO
  // should watch before anything leaves this machine.
  useEffect(() => {
    const onToggle = () => {
      if (sharing) teardown(true);
      else if (!watching) {
        setPicker({ targets: null, mode: "share" });
        void getShareTargets().then((res) => {
          setPicker((p) => (p ? { ...p, targets: res.targets ?? [] } : p));
        });
      }
    };
    window.addEventListener("crm:screenshare-toggle", onToggle);
    return () => window.removeEventListener("crm:screenshare-toggle", onToggle);
  }, [sharing, watching, teardown]);

  // admin-only: open the picker in "whose screen do I want?" mode
  useEffect(() => {
    if (!isAdmin) return;
    const onRequest = () => {
      if (sharing || watching || requesting) return;
      setPicker({ targets: null, mode: "request" });
      void getShareTargets().then((res) => {
        setPicker((p) => (p ? { ...p, targets: res.targets ?? [] } : p));
      });
    };
    window.addEventListener("crm:screenshare-request", onRequest);
    return () => window.removeEventListener("crm:screenshare-request", onRequest);
  }, [isAdmin, sharing, watching, requesting]);

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
    // If I asked this exact person to show me their screen, joining is
    // what I already decided -- skip the "Join?" prompt entirely.
    if (mine && awaitingFromRef.current && mine.sharerId === awaitingFromRef.current) {
      clearRequestTimers();
      awaitingFromRef.current = null;
      setRequesting(null);
      setOffer(null);
      void startWatching(mine);
      return;
    }
    const pick = mine ?? open ?? null;
    setOffer(pick && pick.id !== dismissedRef.current ? pick : null);
    // The chime rings once per targeted session, not once per poll.
    if (mine && mine.id !== dismissedRef.current && dingedRef.current !== mine.id) {
      dingedRef.current = mine.id;
      ding();
    }
  }, [selfId, startWatching, clearRequestTimers]);

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
    // An admin asked to see this person's screen. Same knock-and-chime
    // as an invite, but the button starts THEIR share aimed at the
    // admin. If they're already in a session, auto-decline so the admin
    // isn't left waiting on a busy line.
    ch.on("broadcast", { event: "request" }, ({ payload }) => {
      const p = payload as { fromId: string; fromName: string; to: string };
      if (p.to !== selfId) return;
      if (activeRef.current) {
        ch.send({ type: "broadcast", event: "request-declined", payload: { to: p.fromId, fromName: selfName } });
        return;
      }
      setIncomingRequest({ fromId: p.fromId, fromName: p.fromName });
      // ring only the first ping of a given ask, not each re-send
      if (requestDinged.current !== p.fromId) {
        requestDinged.current = p.fromId;
        ding();
      }
    });
    ch.on("broadcast", { event: "request-cancel" }, ({ payload }) => {
      const p = payload as { to: string };
      if (p.to !== selfId) return;
      requestDinged.current = null;
      setIncomingRequest(null);
    });
    ch.on("broadcast", { event: "request-declined" }, ({ payload }) => {
      const p = payload as { to: string; fromName: string };
      if (p.to !== selfId) return;
      clearRequestTimers();
      awaitingFromRef.current = null;
      setRequesting(null);
      setError(`${p.fromName} isn't available to share right now.`);
    });
    ch.subscribe();
    alertChannel.current = ch;
    const client = supabase.current;
    return () => {
      void client.removeChannel(ch);
      alertChannel.current = null;
    };
  }, [companyId, selfId, selfName, refreshOffers, clearRequestTimers]);

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

  /** Off by default: the browser's own camera permission plus this
   * toggle are the only ways a face goes out -- same consent shape as
   * the screen picker. */
  async function toggleCam() {
    const sender = camSender.current;
    if (!sender) return;
    const role: "sharer" | "viewer" = sharing ? "sharer" : "viewer";
    if (camOn) {
      camStream.current?.getTracks().forEach((t) => t.stop());
      camStream.current = null;
      void sender.replaceTrack(null).catch(() => {});
      setCamOn(false);
      broadcast({ kind: "cam", from: role, on: false });
    } else {
      try {
        const cam = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 } },
        });
        if (camSender.current !== sender) {
          // the session moved on while the permission prompt was open
          cam.getTracks().forEach((t) => t.stop());
          return;
        }
        camStream.current = cam;
        await sender.replaceTrack(cam.getVideoTracks()[0] ?? null);
        setCamOn(true);
        broadcast({ kind: "cam", from: role, on: true });
      } catch {
        // permission denied -- the toggle simply stays off
      }
    }
  }

  const stopShareBack = useCallback(
    (announce: boolean) => {
      shareBackStream.current?.getTracks().forEach((t) => t.stop());
      shareBackStream.current = null;
      void shareBackSender.current?.replaceTrack(null).catch(() => {});
      setShareBackOn(false);
      if (announce) broadcast({ kind: "share-back", on: false });
    },
    [broadcast]
  );

  /** The viewer sharing their own screen back at the sharer -- the
   * same browser picker, the same consent shape, riding the third
   * video lane of the connection that already exists. */
  async function toggleShareBack() {
    const sender = shareBackSender.current;
    if (!sender) return;
    if (shareBackOn) {
      stopShareBack(true);
    } else {
      try {
        const scr = await navigator.mediaDevices.getDisplayMedia({ video: true });
        if (shareBackSender.current !== sender) {
          // the session moved on while the picker was open
          scr.getTracks().forEach((t) => t.stop());
          return;
        }
        shareBackStream.current = scr;
        await sender.replaceTrack(scr.getVideoTracks()[0] ?? null);
        // the browser's own Stop-sharing button must turn this off too
        scr.getVideoTracks()[0]?.addEventListener("ended", () => stopShareBack(true));
        setShareBackOn(true);
        broadcast({ kind: "share-back", on: true });
      } catch {
        // user cancelled the picker
      }
    }
  }

  // The status pill is draggable: it must never be the thing standing
  // between the sharer and the corner of their own screen.
  function pillPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest("button")) return; // buttons still click
    const r = e.currentTarget.getBoundingClientRect();
    pillDrag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function pillPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = pillDrag.current;
    if (!d) return;
    const w = e.currentTarget.offsetWidth;
    setPillPos({
      x: Math.min(Math.max(e.clientX - d.dx, 8 - w / 2), window.innerWidth - w / 2),
      y: Math.min(Math.max(e.clientY - d.dy, 0), window.innerHeight - 40),
    });
  }
  function pillPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    pillDrag.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // capture may already be gone
    }
  }

  // The corner screen window drags the same way the pill does.
  function panelPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest("button")) return;
    const r = e.currentTarget.getBoundingClientRect();
    panelDrag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function panelPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = panelDrag.current;
    if (!d) return;
    const w = e.currentTarget.offsetWidth;
    setPanelPos({
      x: Math.min(Math.max(e.clientX - d.dx, 8 - w / 2), window.innerWidth - w / 2),
      y: Math.min(Math.max(e.clientY - d.dy, 0), window.innerHeight - 40),
    });
  }
  function panelPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    panelDrag.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // capture may already be gone
    }
  }

  return (
    <>
      <audio ref={remoteAudio} autoPlay style={{ display: "none" }} />

      {picker && picker.mode === "share" && !sharing && !watching && (
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

      {picker && picker.mode === "request" && !sharing && !watching && !requesting && (
        <Modal title="See a teammate's screen" onClose={() => setPicker(null)}>
          <p className="module-sub" style={{ marginTop: 0 }}>
            Whose screen do you want to see? They get a pop-up and one tap on{" "}
            <strong>Share now</strong> shows you their screen — you don&apos;t wait for anything else.
          </p>
          {picker.targets === null ? (
            <p className="empty-hint">Loading your team…</p>
          ) : picker.targets.length === 0 ? (
            <p className="empty-hint">No teammates to ask.</p>
          ) : (
            <div className="ss-picker-list">
              {picker.targets.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    setPicker(null);
                    void requestScreen(t.id, t.name);
                  }}
                >
                  👤 {t.name}
                </button>
              ))}
            </div>
          )}
        </Modal>
      )}

      {/* Admin waiting on an answer to a screen request. */}
      {requesting && !sharing && !watching && (
        <div className="ss-pill">
          <span className="ss-dot" />
          Waiting for {requesting.name} to share their screen…
          <button className="btn-ghost small" onClick={cancelRequest}>
            Cancel
          </button>
        </div>
      )}

      {/* The teammate's "show me your screen" knock -- like the invite,
          answered on purpose, not dismissed by a stray click. */}
      {incomingRequest && !sharing && !watching && (
        <Modal title="Screen view request" noBackdropClose onClose={declineRequest}>
          <p style={{ marginTop: 0 }}>
            👁 <strong>{incomingRequest.fromName}</strong> is asking to see your screen.
          </p>
          <div className="modal-actions">
            <button className="btn-ghost" onClick={declineRequest}>
              Not now
            </button>
            <button
              className="btn-primary"
              onClick={() => {
                const req = incomingRequest;
                requestDinged.current = null;
                setIncomingRequest(null);
                void startSharing(req.fromId, req.fromName);
              }}
            >
              Share now
            </button>
          </div>
        </Modal>
      )}

      {sharing && (
        <div
          className="ss-pill"
          style={pillPos ? { left: pillPos.x, top: pillPos.y, transform: "none" } : undefined}
          onPointerDown={pillPointerDown}
          onPointerMove={pillPointerMove}
          onPointerUp={pillPointerUp}
          title="Drag me anywhere"
        >
          <span className="ss-dot" />
          Sharing your screen
          {viewerHere
            ? ` — ${inviteeName ?? "a teammate"} is watching`
            : ` — waiting for ${inviteeName ?? "a teammate"}`}
          <button className="btn-ghost small" onClick={toggleMic}>
            {micOn ? "🎙 Mic on" : "🔇 Mic off"}
          </button>
          {viewerHere && (
            <button className="btn-ghost small" onClick={() => void toggleCam()}>
              {camOn ? "📷 Cam on" : "📷 Cam off"}
            </button>
          )}
          <button className="btn-primary small" onClick={() => teardown(true)}>
            Stop
          </button>
        </div>
      )}

      {/* The viewer's face, floated over the app while sharing. The
          element stays mounted (hidden) so an arriving track always
          has somewhere to land. */}
      {sharing && (
        <div className="ss-cam-bubble" style={{ display: remoteCamOn ? undefined : "none" }}>
          <video ref={camVideo} autoPlay playsInline muted />
          <span className="ss-cam-name">{inviteeName ?? "Teammate"}</span>
        </div>
      )}

      {/* The viewer's screen coming back the other way. NEVER
          full-screen here: this side's screen is being captured, and a
          captured screen showing a full-screen copy of the other
          captured screen is the hall-of-mirrors tunnel. A corner
          window bounds the reflection to one small copy. Mounted
          (hidden) while sharing so the track has somewhere to land. */}
      {sharing && (
        <div
          className="ss-screen-panel"
          role="dialog"
          aria-label="Teammate's screen"
          style={{
            display: remoteShareBack ? undefined : "none",
            ...(panelPos ? { left: panelPos.x, top: panelPos.y, bottom: "auto" } : null),
          }}
          onPointerDown={panelPointerDown}
          onPointerMove={panelPointerMove}
          onPointerUp={panelPointerUp}
          title="Drag me anywhere"
        >
          <div className="ss-viewer-head">
            <span>
              <span className="ss-dot" /> <strong>{inviteeName ?? "Your teammate"}</strong>&apos;s screen
            </span>
          </div>
          <video ref={backVideo} autoPlay playsInline className="ss-video" />
        </div>
      )}

      {offer && !sharing && !watching && offer.invitedTo === selfId ? (
        // A direct invite is a knock, not a notice -- centered, named,
        // and impossible to miss.
        <Modal
          title="Screen share invite"
          noBackdropClose
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

      {/* Full-screen while only watching; the moment this side shares
          its own screen back, the SAME surface (same video element --
          a remount would drop the stream) shrinks to a draggable
          corner window, for the mirror-tunnel reason above. */}
      {watching && (
        <div
          className={shareBackOn ? "ss-screen-panel" : "ss-viewer"}
          role="dialog"
          aria-label="Screen share"
          style={
            shareBackOn && panelPos ? { left: panelPos.x, top: panelPos.y, bottom: "auto" } : undefined
          }
          onPointerDown={shareBackOn ? panelPointerDown : undefined}
          onPointerMove={shareBackOn ? panelPointerMove : undefined}
          onPointerUp={shareBackOn ? panelPointerUp : undefined}
          title={shareBackOn ? "Drag me anywhere" : undefined}
        >
          <div className="ss-viewer-head">
            <span>
              <span className="ss-dot" /> Watching <strong>{watching.sharerName}</strong>&apos;s screen
              {shareBackOn ? " — sharing yours too" : ""}
            </span>
            <div className="ss-viewer-tools">
              <button className="btn-ghost small" onClick={toggleMic}>
                {micOn ? "🎙 Mic on" : "🔇 Mic off"}
              </button>
              <button className="btn-ghost small" onClick={() => void toggleCam()}>
                {camOn ? "📷 Cam on" : "📷 Cam off"}
              </button>
              <button className="btn-ghost small" onClick={() => void toggleShareBack()}>
                {shareBackOn ? "🖥 Stop my screen" : "🖥 Share mine too"}
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
          <video ref={remoteVideo} autoPlay playsInline className="ss-video" />
          {/* the sharer's face over their shared screen */}
          <div className="ss-cam-bubble" style={{ display: remoteCamOn ? undefined : "none" }}>
            <video ref={camVideo} autoPlay playsInline muted />
            <span className="ss-cam-name">{watching.sharerName}</span>
          </div>
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
