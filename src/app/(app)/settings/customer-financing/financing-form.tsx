"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveFinancingSettings, type FinancingSettings } from "@/lib/actions/financing";

/**
 * The company's lender and its application link (DECISIONS #161). Empty
 * both and save to switch the offer off.
 */
export function FinancingForm({ initial }: { initial: FinancingSettings }) {
  const router = useRouter();
  const [provider, setProvider] = useState(initial.provider);
  const [url, setUrl] = useState(initial.url);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const changed = provider !== initial.provider || url !== initial.url;
  const on = !!(initial.provider && initial.url);

  function save(next: { provider: string; url: string }) {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await saveFinancingSettings(next);
      if (res.error) return setError(res.error);
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <section className="est-pay">
      <h2 className="est-pay-title">Your lender</h2>
      <p className="est-tax-note">
        If you offer financing through a lender (Wisetack, Hearth, GreenSky or another), look in
        your lender&apos;s dashboard for the link where your customers apply, and paste it here.
        Customers then see{" "}
        <strong>Apply for financing</strong> on their estimates and contracts in their customer
        page, until the job is paid for. The lender takes the application, decides, and sets the
        terms. You&apos;ll hear from the lender, not from the CRM.
      </p>
      <p className="est-tax-note">
        The CRM never shows an interest rate or a monthly payment. Those have to come from the
        lender, with its own terms.
      </p>
      {!initial.ready && (
        <p className="error-note">
          Financing needs a database update first: run 0214_customer_financing.sql in Supabase.
        </p>
      )}
      <label className="field" style={{ maxWidth: 360, marginTop: 14 }}>
        <span className="field-label">Lender (customers see this name)</span>
        <input
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value);
            setSaved(false);
          }}
          placeholder="e.g. Wisetack"
          maxLength={60}
          disabled={pending || !initial.ready}
        />
      </label>
      <label className="field" style={{ maxWidth: 560, marginTop: 12 }}>
        <span className="field-label">Application link</span>
        <input
          type="url"
          inputMode="url"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setSaved(false);
          }}
          placeholder="https://"
          maxLength={500}
          disabled={pending || !initial.ready}
        />
      </label>
      {error && <p className="error-note">{error}</p>}
      {saved && <p className="hint-note">Saved.</p>}
      <div className="est-pay-actions" style={{ marginTop: 14 }}>
        <button
          className="btn-primary"
          onClick={() => save({ provider, url })}
          disabled={pending || !initial.ready || !changed}
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {on && (
          <>
            <a className="btn-ghost" href={initial.url} target="_blank" rel="noopener noreferrer">
              Open the link
            </a>
            <button
              className="btn-ghost"
              type="button"
              disabled={pending}
              onClick={() => {
                if (!window.confirm("Stop offering financing to customers?")) return;
                setProvider("");
                setUrl("");
                save({ provider: "", url: "" });
              }}
            >
              Turn off
            </button>
          </>
        )}
      </div>
    </section>
  );
}
