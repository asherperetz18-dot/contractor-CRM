"use client";

import { useState } from "react";
import { openBillingPortal } from "@/lib/actions/billing";

export function ManageBillingButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setBusy(true);
    setError(null);
    const res = await openBillingPortal();
    if (res.url) {
      window.location.href = res.url;
      return;
    }
    setError(res.error ?? "Couldn't open billing. Try again.");
    setBusy(false);
  }

  return (
    <>
      <button type="button" className="btn-primary" disabled={busy} onClick={open}>
        {busy ? "Opening…" : "Manage billing"}
      </button>
      {error && <p className="error-note">{error}</p>}
    </>
  );
}
