"use client";

import { useEffect, useState } from "react";

/**
 * The dialer's toolbar trigger. The dialer itself stays mounted at the
 * layout level; this button only toggles it, and turns green while a
 * call is live so closing the panel never hides the fact of the call.
 *
 * The glyph is an inline SVG, not the 📞 emoji: an emoji is painted by
 * the font in its own fixed colours and cannot be recoloured, so a green
 * phone had to come from a real icon. It strokes with currentColor --
 * green normally, and white once .topbar-dialer-active paints the chip
 * green for a live call.
 */
export function DialerButton() {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onBusy = (e: Event) => {
      setBusy(!!(e as CustomEvent<{ busy: boolean }>).detail?.busy);
    };
    window.addEventListener("crm:dialer-busy", onBusy);
    return () => window.removeEventListener("crm:dialer-busy", onBusy);
  }, []);

  return (
    <button
      type="button"
      className={"icon-btn topbar-icon-btn" + (busy ? " topbar-dialer-active" : "")}
      // Left off while busy so the active-call class keeps its white
      // glyph on the green pill -- an inline colour would outrank it.
      style={busy ? undefined : { color: "var(--success)" }}
      onClick={() => window.dispatchEvent(new CustomEvent("crm:dialer-toggle"))}
      aria-label="Open dialer"
      title={busy ? "On a call — open dialer" : "In-App Dialer"}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
      </svg>
    </button>
  );
}
