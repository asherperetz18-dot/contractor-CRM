"use client";

import { useState } from "react";
import { openBillingPortal } from "@/lib/actions/billing";
import { WebOnly } from "@/components/web-only";

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

  // Managing the subscription happens outside the Play Store app, and the
  // app may not point there either (DECISIONS #087).
  return (
    <WebOnly fallback={<p className="est-pay-sub">Billing can&apos;t be managed in the app.</p>}>
      <p className="est-pay-sub">
        Update the card you pay with, download invoices, or cancel. It opens on
        Stripe&apos;s own secure page and brings you back here when you&apos;re done.
      </p>
      <button type="button" className="btn-primary" disabled={busy} onClick={open}>
        {busy ? "Opening…" : "Manage billing"}
      </button>
      {error && <p className="error-note">{error}</p>}
    </WebOnly>
  );
}
