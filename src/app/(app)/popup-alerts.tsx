"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getPopupAlerts } from "@/lib/actions/popup-alerts";
import type { FreshText } from "@/lib/actions/text-alerts";
import { shapeToasts, type PopupToast } from "@/lib/popup-shape";
import { readPopupPrefs, usePopupPrefs } from "./popup-prefs";
import { PopupToastList } from "./popup-toast-list";
import "./popup-alerts.css";

const POLL_MS = 20_000;
const TOAST_MS = 8_000;
// How many pop at once. The rest are in the bell.
const MAX_SHOWN = 4;
// The poll asks for things a little OLDER than the newest one already
// seen: a row's timestamp is stamped when its insert starts, but the row
// only becomes visible at commit -- so it can commit AFTER, yet be
// timestamped BEFORE, the row that advanced the watermark. The margin
// re-reads that window; the seen-id set keeps the overlap from ever
// toasting twice.
const OVERLAP_MS = 120_000;

/** Fired when new events land, so the bell refreshes right away instead
 *  of waiting out its own poll. */
export const FRESH_EVENT = "crm:alerts-fresh";

function readStore(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStore(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // private mode etc. -- the watcher just forgets between reloads.
  }
}

// One AudioContext for the tab, created on the first click or keypress.
// Browsers refuse audio in a tab the user never touched; a context made
// during that refusal stays suspended FOREVER, so the unlock has to
// happen inside a real user gesture and the ding has to reuse it.
let audioCtx: AudioContext | null = null;
function unlockAudio() {
  try {
    type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext };
    const Ctor = window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
    if (!Ctor) return;
    audioCtx = audioCtx ?? new Ctor();
    if (audioCtx.state === "suspended") void audioCtx.resume();
  } catch {
    audioCtx = null;
  }
}

/** A short synthesized ding -- no audio asset to ship or cache-bust. */
function ding() {
  try {
    if (!audioCtx || audioCtx.state !== "running") return;
    const ctx = audioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch {
    // no sound is fine; the toast is the alert.
  }
}

function textToast(t: FreshText): PopupToast {
  return {
    id: `text:${t.id}`,
    kind: "message",
    icon: "💬",
    title: `New text from ${t.name}`,
    body: t.preview,
    // Straight to THAT conversation -- the inbox deep-links by lead or,
    // for a text that matched nobody, by the sender's number.
    href: t.leadId
      ? `/reply-inbox?leadId=${encodeURIComponent(t.leadId)}`
      : `/reply-inbox?phone=${encodeURIComponent(t.fromNumber)}`,
    sticky: false,
  };
}

/**
 * The popup watcher, mounted on every screen for every role that has a
 * bell. Polls for what just happened -- a customer text, a payment, a
 * signature, a proposal opened, a new lead, an appointment or job step
 * handed to you -- and pops it in the corner with a ding, wherever in
 * the CRM the person happens to be. Keeps the sidebar badge fed and
 * flashes the tab title when the CRM is in a background window.
 *
 * Each open tab alerts on its own -- two screens at the dispatch desk
 * both ring, which is the point.
 */
export function PopupAlerts({ companyId }: { companyId: string }) {
  const router = useRouter();
  const [toasts, setToasts] = useState<PopupToast[]>([]);
  const [count, setCount] = useState(0);
  const [prefs, updatePrefs] = usePopupPrefs();
  const textsSeen = useRef<string | null>(null);
  const eventsSeen = useRef<string | null>(null);
  const baseTitle = useRef<string>("");
  // Mirrors `count` for the poll closure, which must not restart on
  // every state change.
  const awaiting = useRef(0);
  // Things that arrived while the window was behind another one: the
  // tab title counts them until the person comes back.
  const hiddenNew = useRef(0);

  // Scoped per company: this app is multi-tenant, and one shared
  // watermark would mark company B's texts "seen" because company A's
  // were. The texts key is the one the old watcher used, so nobody's
  // overnight texts replay after this update.
  const textsKey = `crm:texts-seen:${companyId}`;
  const eventsKey = `crm:events-seen:${companyId}`;

  useEffect(() => {
    baseTitle.current = document.title;
    // Start from where this browser last left off, so a text that
    // arrived overnight still greets the morning with a toast -- but a
    // brand-new browser starts at "now" instead of replaying a month.
    textsSeen.current = readStore(textsKey) ?? new Date().toISOString();
    eventsSeen.current = readStore(eventsKey) ?? new Date().toISOString();

    let cancelled = false;
    let inFlight = false;
    // Ids already toasted, so the overlap margin and any poll overlap
    // can never ding the same thing twice. Bounded; old ids age out.
    const seenIds = new Set<string>();
    const timers = new Set<ReturnType<typeof setTimeout>>();

    window.addEventListener("pointerdown", unlockAudio);
    window.addEventListener("keydown", unlockAudio);

    const back = (iso: string | null) =>
      iso ? new Date(Date.parse(iso) - OVERLAP_MS).toISOString() : null;

    // The tab title carries the alert when the window is behind another
    // one -- and stands down there too, once the texts get answered from
    // some other screen.
    function setTitle() {
      if (document.hidden) {
        const n = awaiting.current + hiddenNew.current;
        document.title = n > 0 ? `(${n}) New alerts — ${baseTitle.current}` : baseTitle.current;
      } else {
        document.title = baseTitle.current;
      }
    }

    async function poll() {
      if (inFlight) return;
      inFlight = true;
      try {
        const res = await getPopupAlerts({
          textsSince: back(textsSeen.current),
          eventsSince: back(eventsSeen.current),
        }).catch(() => null);
        if (cancelled || !res || res.error || !res.data) return;
        const { texts, events, latestIso } = res.data;

        const n = texts.awaitingCount ?? 0;
        awaiting.current = n;
        setCount(n);
        window.dispatchEvent(new CustomEvent("crm:inbox-count", { detail: n }));

        // Monotonic: an overlapping or stale response must never drag a
        // watermark backwards.
        if (
          texts.latestIso &&
          (!textsSeen.current || Date.parse(texts.latestIso) > Date.parse(textsSeen.current))
        ) {
          textsSeen.current = texts.latestIso;
          writeStore(textsKey, texts.latestIso);
        }
        if (
          latestIso &&
          (!eventsSeen.current || Date.parse(latestIso) > Date.parse(eventsSeen.current))
        ) {
          eventsSeen.current = latestIso;
          writeStore(eventsKey, latestIso);
        }

        const incoming: PopupToast[] = [
          ...(texts.fresh ?? []).map(textToast),
          ...events.map(({ id, kind, icon, title, body, href, sticky }) => ({
            id,
            kind,
            icon,
            title,
            body,
            href,
            sticky,
          })),
        ].filter((t) => !seenIds.has(t.id));
        for (const t of incoming) seenIds.add(t.id);
        if (seenIds.size > 500) {
          for (const id of [...seenIds].slice(0, 200)) seenIds.delete(id);
        }

        if (events.length) window.dispatchEvent(new CustomEvent(FRESH_EVENT));

        // Switches are read live, not from the closure: one flipped a
        // minute ago has to apply to THIS poll.
        const current = readPopupPrefs();
        const fresh = shapeToasts(incoming, current);
        if (fresh.length) {
          setToasts((t) => [...fresh, ...t].slice(0, MAX_SHOWN));
          if (current.sound) ding();
          if (document.hidden) hiddenNew.current += fresh.length;
          for (const f of fresh) {
            // Money and signatures wait to be seen; the rest fade.
            if (f.sticky) continue;
            const timer = setTimeout(() => {
              timers.delete(timer);
              if (!cancelled) setToasts((t) => t.filter((x) => x.id !== f.id));
            }, TOAST_MS);
            timers.add(timer);
          }
        }

        setTitle();
      } finally {
        inFlight = false;
      }
    }

    poll();
    const interval = setInterval(poll, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) {
        hiddenNew.current = 0;
        document.title = baseTitle.current;
        poll();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
      for (const t of timers) clearTimeout(t);
      document.title = baseTitle.current;
    };
  }, [textsKey, eventsKey]);

  function dismiss(id: string) {
    setToasts((x) => x.filter((y) => y.id !== id));
  }

  function open(t: PopupToast) {
    dismiss(t.id);
    router.push(t.href);
  }

  return (
    <PopupToastList
      toasts={toasts}
      awaiting={count}
      sound={prefs.sound}
      onOpen={open}
      onDismiss={dismiss}
      onToggleSound={() => updatePrefs({ sound: !prefs.sound })}
    />
  );
}
