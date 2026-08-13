"use client";

import { useEffect, useState } from "react";

// Five minutes. A deploy is not urgent enough to poll harder, and every
// open tab in the company runs this timer.
const POLL_MS = 5 * 60 * 1000;

/**
 * Tells people a new version is out, and lets them choose when to take it.
 *
 * `current` is baked into the page the browser loaded; /api/version is
 * answered by whatever is deployed now. They differ exactly when a deploy
 * has happened since the tab was opened.
 *
 * It never reloads on its own. A rep three-quarters through writing an
 * estimate would lose the lot, and an app that throws away your work to
 * improve itself teaches people to distrust it. The banner waits.
 *
 * Checked when the tab becomes visible as well as on the timer, because
 * the realistic case is a laptop left open overnight: the check that
 * matters is the one that happens when somebody comes back to it.
 */
export function UpdateNotice({ current }: { current: string }) {
  const [latest, setLatest] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;

    async function check() {
      // Skipped while hidden: a background tab polling every five minutes
      // for a week is noise on someone's battery and our logs.
      if (document.visibilityState !== "visible") return;
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

  const stale = !!latest && latest !== current && latest !== dismissed;
  if (!stale) return null;

  return (
    <div className="update-notice" role="status">
      <span className="update-notice-dot" />
      <span>
        <strong>Update available</strong> &mdash; v{latest}. Refresh when you reach a good
        stopping point; anything unsaved on this screen will be lost.
      </span>
      <button className="btn-primary small" onClick={() => window.location.reload()}>
        Refresh
      </button>
      {/* Dismiss hides this version only. A later release shows the banner
          again, so ignoring one update does not silence the next. */}
      <button className="btn-ghost small" onClick={() => setDismissed(latest)}>
        Later
      </button>
    </div>
  );
}
