"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { savePaymentReceiptSettings } from "@/lib/actions/settings";

/**
 * The company's switch for the receipt a customer is emailed when they
 * pay online (DECISIONS #151). On unless switched off -- a company whose
 * own Stripe account already emails receipts may not want two.
 */
export function PaymentReceipts({ enabled, ready }: { enabled: boolean; ready: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await savePaymentReceiptSettings(on);
      if (res.error) return setError(res.error);
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <section className="est-pay">
      <h2 className="est-pay-title">Receipts</h2>
      <p className="est-pay-sub">
        When a customer pays online, they&apos;re emailed a receipt from you once the money has
        arrived: the amount, what it paid for, and what is still owed. A payment you record by hand
        gets one when you tick <strong>Email the customer a receipt</strong>, and any paid payment
        can be sent again from <strong>Payments</strong>.
      </p>
      {!ready && (
        <p className="error-note">
          Receipts need a database update first: run 0207_payment_receipts.sql in Supabase.
        </p>
      )}
      <label className="est-record-check">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            setOn(e.target.checked);
            setSaved(false);
          }}
          disabled={pending || !ready}
        />
        <span>
          Email a receipt when a customer pays online{" "}
          <span className="est-tax-note">
            — untick if your Stripe account already emails them one
          </span>
        </span>
      </label>
      {error && <p className="error-note">{error}</p>}
      {saved && <p className="hint-note">Saved.</p>}
      <div className="est-pay-actions">
        <button className="btn-primary" onClick={save} disabled={pending || !ready || on === enabled}>
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </section>
  );
}
