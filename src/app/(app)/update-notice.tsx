"use client";

import { useEffect, useState } from "react";
import { shouldPromptUpdate, type UpdateSnooze } from "@/lib/update-popup";

// Five minutes. A deploy is not urgent enough to poll harder, and every
// open tab in the company runs this timer. The snooze window is the same
// length, so "Later" quiets exactly one poll cycle before the popup
// puts itself back.
const POLL_MS = 5 * 60 * 1000;

/**
 * Puts a popup on screen, automatically, whenever a deploy has happened
 * since this tab loaded its bundle.
 *
 * `current` is baked into the page the browser loaded; /api/version is
 * answered by whatever is deployed now. They differ exactly when a deploy
 * has happened since the tab was opened.
 *
 * It never reloads on its own. A rep three-quarters through writing an
 * estimate would lose the lot, and an app that throws away your work to
 * improve itself teaches people to distrust it. But it also never goes
 * quiet: "Later" postpones one poll cycle (see SNOOZE_MS), then the
 * popup returns on its own -- the old corner banner let one dismissal
 * silence a version until the tab was closed, and people ran week-old
 * bundles because of it.
 *
 * Checked when the tab becomes visible as well as on the timer, because
 * the realistic case is a laptop left open overnight: the check that
 * matters is the one that happens when somebody comes back to it.
 */
export function UpdateNotice({ current }: { current: string }) {
  const [latest, setLatest] = useState<string | null>(null);
  const [snooze, setSnooze] = useState<UpdateSnooze | null>(null);
  // Advanced by every check so an expired snooze re-renders even when
  // /api/version keeps answering the same string (React skips renders
  // for identical state, so setLatest alone would never wake us up).
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let stopped = false;

    async function check() {
      // Skipped while hidden: a background tab polling every five minutes
      // for a week is noise on someone's battery and our logs.
      if (document.visibilityState !== "visible") return;
      if (!stopped) setNow(Date.now());
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const data: { version?: string } = await res.json();
        if (!stopped && data.version) setLatest(data.version);
      } catch {
        // Offline, or mid-deploy. Silent on purpose -- a failed version
        // check is not something to interrupt anybody about.
      }
    }

    check();
    const timer = setInterval(check, POLL_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  if (!shouldPromptUpdate(current, latest, snooze, now)) return null;

  return (
    <div className="modal-backdrop update-popup-backdrop">
      <div
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="update-popup-title"
      >
        <div className="modal-head">
          <h3 id="update-popup-title">Update available</h3>
        </div>
        <div className="modal-body">
          <p style={{ margin: 0 }}>
            A new version of the app is out (v{latest}). Refresh to get it
            &mdash; anything unsaved on this screen will be lost, so finish
            what you&apos;re typing first.
          </p>
          <div className="modal-actions" style={{ justifyContent: "flex-end", gap: 8 }}>
            {/* Later postpones only: the popup returns by itself after
                SNOOZE_MS, and a newer release re-prompts immediately. */}
            <button
              className="btn-ghost"
              onClick={() =>
                setSnooze(latest ? { version: latest, at: Date.now() } : null)
              }
            >
              Later
            </button>
            <button className="btn-primary" onClick={() => window.location.reload()}>
              Refresh now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
