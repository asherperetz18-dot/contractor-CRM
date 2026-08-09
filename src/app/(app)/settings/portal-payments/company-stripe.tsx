"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveCompanyStripeKeys,
  clearCompanyStripeKeys,
  getCompanyStripeStatus,
  type CompanyStripeStatus,
} from "@/lib/actions/stripe-admin";

/**
 * Where a contractor connects their own Stripe account.
 *
 * The fields are write-only: a saved key is never sent back to the
 * browser, only its last four characters, so there is no path by which
 * one business's live secret can be read out of this screen.
 */
export function CompanyStripe() {
  const router = useRouter();
  const [status, setStatus] = useState<CompanyStripeStatus | null>(null);
  const [secretKey, setSecretKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await getCompanyStripeStatus();
      if (!cancelled) setStatus(s);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status) return null;

  function save() {
    setError(null);
    setNote(null);
    startTransition(async () => {
      const res = await saveCompanyStripeKeys({ secretKey, webhookSecret });
      if (res.error) return setError(res.error);
      // Cleared immediately: no reason for a live secret to sit in a
      // form field after it has been stored.
      setSecretKey("");
      setWebhookSecret("");
      setEditing(false);
      setNote(`Connected in ${res.mode} mode.`);
      setStatus(await getCompanyStripeStatus());
      router.refresh();
    });
  }

  function disconnect() {
    setError(null);
    startTransition(async () => {
      const res = await clearCompanyStripeKeys();
      if (res.error) return setError(res.error);
      setNote("Disconnected.");
      setStatus(await getCompanyStripeStatus());
      router.refresh();
    });
  }

  return (
    <section className="est-pay">
      <div className="est-pay-head">
        <div>
          <h2 className="est-pay-title">This company&apos;s Stripe account</h2>
          <p className="est-pay-sub">
            Payments from this company&apos;s customers go into this account. Every company keeps
            its own.
          </p>
        </div>
        {status.connected && !editing && (
          <div className="est-pay-actions">
            <button className="btn-ghost" onClick={() => setEditing(true)} disabled={pending}>
              Replace keys
            </button>
            <button className="btn-ghost" onClick={disconnect} disabled={pending}>
              Disconnect
            </button>
          </div>
        )}
      </div>

      {!status.encryptionReady && (
        <p className="error-note">
          Credential encryption isn&apos;t configured on the server, so keys can&apos;t be stored.
          Set <code>APP_ENCRYPTION_KEY</code> in the deployment environment and redeploy.
        </p>
      )}
      {error && <p className="error-note">{error}</p>}
      {note && <p className="hint-note">{note}</p>}

      {status.connected && !editing ? (
        <ul className="pp-checks">
          <li>
            Connected{status.connectedAt ? ` on ${new Date(status.connectedAt).toLocaleDateString("en-US")}` : ""} —{" "}
            <strong>{status.mode === "live" ? "live" : "test"} mode</strong>, key ending{" "}
            <span className="mono">{status.last4}</span>.
          </li>
        </ul>
      ) : (
        <>
          <label className="field">
            <span className="field-label">Stripe secret key</span>
            <input
              className="est-title-input"
              type="password"
              autoComplete="off"
              placeholder="sk_live_…"
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value)}
              disabled={pending || !status.encryptionReady}
            />
          </label>
          <label className="field">
            <span className="field-label">Webhook signing secret</span>
            <input
              className="est-title-input"
              type="password"
              autoComplete="off"
              placeholder="whsec_…"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              disabled={pending || !status.encryptionReady}
            />
          </label>
          <div className="est-pay-actions">
            <button
              className="btn-primary"
              onClick={save}
              disabled={pending || !secretKey.trim() || !status.encryptionReady}
            >
              {pending ? "Saving…" : "Connect account"}
            </button>
            {editing && (
              <button className="btn-ghost" onClick={() => setEditing(false)} disabled={pending}>
                Cancel
              </button>
            )}
          </div>
        </>
      )}

      {/* Unique per company, because each account signs with its own
          secret and the company has to be known before the payload can
          be verified. */}
      <div className="pp-webhook-url">
        <div className="field-label">This company&apos;s webhook URL — add it in Stripe</div>
        <div className="pp-url-row">
          <code className="mono">{status.webhookUrl}</code>
          <button
            className="btn-ghost"
            onClick={() => {
              navigator.clipboard.writeText(status.webhookUrl);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="est-tax-note">
          In Stripe: Developers → Webhooks → Add endpoint, subscribing{" "}
          <span className="mono">checkout.session.completed</span>,{" "}
          <span className="mono">async_payment_succeeded</span>,{" "}
          <span className="mono">async_payment_failed</span> and{" "}
          <span className="mono">expired</span>. Paste its signing secret above.
        </p>
      </div>
    </section>
  );
}
