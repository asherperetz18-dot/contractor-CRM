"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getTextAlerts, type FreshText } from "@/lib/actions/text-alerts";

const POLL_MS = 20_000;
const TOAST_MS = 8_000;
// The poll asks for texts a little OLDER than the newest one already
// seen: a row's created_at is stamped when its insert starts, but the
// row only becomes visible at commit -- so a customer text can commit
// AFTER, yet be timestamped BEFORE, the reply that advanced the
// watermark. The margin re-reads that window; the seen-id set keeps the
// overlap from ever toasting twice.
const OVERLAP_MS = 120_000;
const MUTE_KEY = "crm:text-ding-muted";

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

/**
 * The incoming-text watcher, mounted on every screen for the roles that
 * staff the phones. Polls for new inbound texts, pops a toast with a
 * ding, keeps the sidebar badge fed, and flashes the tab title when the
 * CRM is in a background window. Each open tab alerts on its own -- two
 * screens at the dispatch desk both ring, which is the point.
 */
export function InboxAlerts({ companyId }: { companyId: string }) {
  const router = useRouter();
  const [toasts, setToasts] = useState<FreshText[]>([]);
  // readStore is try/catch-wrapped, so the server render (no
  // localStorage) and a locked-down browser both just get the default.
  const [muted, setMuted] = useState(() => readStore(MUTE_KEY) === "1");
  const [count, setCount] = useState(0);
  const lastSeen = useRef<string | null>(null);
  const baseTitle = useRef<string>("");
  const mutedRef = useRef(muted);

  // Scoped per company: this app is multi-tenant, and one shared
  // watermark would mark company B's texts "seen" because company A's
  // were.
  const seenKey = `crm:texts-seen:${companyId}`;

  useEffect(() => {
    baseTitle.current = document.title;
    // Start from where this browser last left off, so a text that
    // arrived overnight still greets the morning with a toast -- but
    // a brand-new browser starts at "now" instead of replaying a month.
    lastSeen.current = readStore(seenKey) ?? new Date().toISOString();

    let cancelled = false;
    let inFlight = false;
    // Ids already toasted, so the overlap margin and any poll overlap
    // can never ding the same text twice. Bounded; old ids age out.
    const seenIds = new Set<string>();
    const timers = new Set<ReturnType<typeof setTimeout>>();

    window.addEventListener("pointerdown", unlockAudio);
    window.addEventListener("keydown", unlockAudio);

    async function poll() {
      if (inFlight) return;
      inFlight = true;
      try {
        const since = lastSeen.current
          ? new Date(Date.parse(lastSeen.current) - OVERLAP_MS).toISOString()
          : null;
        const res = await getTextAlerts(since).catch(() => null);
        if (cancelled || !res || res.error) return;

        const n = res.awaitingCount ?? 0;
        setCount(n);
        window.dispatchEvent(new CustomEvent("crm:inbox-count", { detail: n }));

        // Monotonic: an overlapping or stale response must never drag
        // the watermark backwards.
        if (
          res.latestIso &&
          (!lastSeen.current || Date.parse(res.latestIso) > Date.parse(lastSeen.current))
        ) {
          lastSeen.current = res.latestIso;
          writeStore(seenKey, res.latestIso);
        }

        const fresh = (res.fresh ?? []).filter((f) => !seenIds.has(f.id));
        for (const f of fresh) seenIds.add(f.id);
        if (seenIds.size > 500) {
          for (const id of [...seenIds].slice(0, 200)) seenIds.delete(id);
        }

        if (fresh.length) {
          setToasts((t) => [...fresh, ...t].slice(0, 3));
          if (!mutedRef.current) ding();
          for (const f of fresh) {
            const timer = setTimeout(() => {
              timers.delete(timer);
              if (!cancelled) setToasts((t) => t.filter((x) => x.id !== f.id));
            }, TOAST_MS);
            timers.add(timer);
          }
        }

        // The tab title carries the alert when the window is behind
        // another one -- and stands down there too, once the texts get
        // answered from some other screen.
        if (document.hidden) {
          document.title =
            n > 0 ? `(${n}) New text${n === 1 ? "" : "s"} — ${baseTitle.current}` : baseTitle.current;
        } else {
          document.title = baseTitle.current;
        }
      } finally {
        inFlight = false;
      }
    }

    poll();
    const interval = setInterval(poll, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) {
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
  }, [seenKey]);

  function toggleMute() {
    setMuted((m) => {
      const next = !m;
      mutedRef.current = next;
      writeStore(MUTE_KEY, next ? "1" : "0");
      return next;
    });
  }

  function open(t: FreshText) {
    // Straight to THAT conversation -- the inbox deep-links by lead or,
    // for a text that matched nobody, by the sender's number.
    const target = t.leadId
      ? `/reply-inbox?leadId=${encodeURIComponent(t.leadId)}`
      : `/reply-inbox?phone=${encodeURIComponent(t.fromNumber)}`;
    setToasts((x) => x.filter((y) => y.id !== t.id));
    router.push(target);
  }

  if (toasts.length === 0) return null;

  return (
    <div className="text-toast-wrap" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="text-toast">
          <button className="text-toast-body" onClick={() => open(t)}>
            <span className="text-toast-title">💬 New text from {t.name}</span>
            {t.preview && <span className="text-toast-preview">{t.preview}</span>}
          </button>
          <div className="text-toast-side">
            <button
              className="icon-btn"
              aria-label={muted ? "Unmute text alerts" : "Mute text alerts"}
              title={muted ? "Sound off — tap to unmute" : "Sound on — tap to mute"}
              onClick={toggleMute}
            >
              {muted ? "🔕" : "🔔"}
            </button>
            <button
              className="icon-btn"
              aria-label="Dismiss"
              onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}
            >
              ✕
            </button>
          </div>
        </div>
      ))}
      {count > toasts.length && (
        <div className="text-toast-more">{count} conversations waiting in the Reply Inbox</div>
      )}
    </div>
  );
}
