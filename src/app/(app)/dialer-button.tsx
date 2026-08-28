"use client";

import { useEffect, useState } from "react";

/**
 * The dialer's toolbar trigger. The dialer itself stays mounted at the
 * layout level; this button only toggles it, and turns green while a
 * call is live so closing the panel never hides the fact of the call.
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
      onClick={() => window.dispatchEvent(new CustomEvent("crm:dialer-toggle"))}
      aria-label="Open dialer"
      title={busy ? "On a call — open dialer" : "In-App Dialer"}
    >
      📞
    </button>
  );
}
