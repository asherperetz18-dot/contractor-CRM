"use client";

import { useEffect, useState } from "react";
import { shouldShowWhatsNew, type ReleaseNote } from "@/lib/release-notes";

/** Where this browser remembers the last version it said "Got it" to. */
const SEEN_KEY = "crm.whats-new.seen";

function readSeen(): string | null {
  try {
    return window.localStorage.getItem(SEEN_KEY);
  } catch {
    // Private window, blocked storage: treat as never seen. The screen
    // shows again next load, which is the safe direction to fail.
    return null;
  }
}

function writeSeen(version: string) {
  try {
    window.localStorage.setItem(SEEN_KEY, version);
  } catch {
    // Same as above -- nothing to do about it, nothing to tell anyone.
  }
}

/**
 * The screen that announces an update after it has arrived.
 *
 * The update popup (`update-notice.tsx`) reaches tabs that were already
 * open when a deploy happened. This one reaches everybody else: whoever
 * opens the CRM fresh, or refreshed from that popup, sees what changed
 * in the build they just loaded -- once per version, per browser. "Got
 * it" records the version, so it stays quiet until the next release.
 *
 * `release` is resolved on the server from the version baked into this
 * render, so the notes on screen are always the notes for the code that
 * is actually running. Decided in an effect, not during render, because
 * the server has no localStorage and a mismatch would flash the screen
 * for everyone before hiding it again -- deferred one microtask, the
 * daily brief's idiom, so it is a post-mount read and not a render-time
 * state write.
 */
export function WhatsNewNotice({ release }: { release: ReleaseNote | null }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!release) return;
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setOpen(shouldShowWhatsNew(release.version, readSeen()));
    })();
    return () => {
      cancelled = true;
    };
  }, [release]);

  if (!open || !release) return null;

  function dismiss() {
    if (release) writeSeen(release.version);
    setOpen(false);
  }

  return (
    <div className="modal-backdrop whats-new-backdrop">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
      >
        <div className="modal-head">
          <h3 id="whats-new-title">What&apos;s new in v{release.version}</h3>
        </div>
        <div className="modal-body">
          <p className="whats-new-date">Updated {release.date}</p>
          <ul className="release-notes-list">
            {release.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
          <div className="modal-actions" style={{ justifyContent: "flex-end" }}>
            <button className="btn-primary" onClick={dismiss}>
              Got it
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
