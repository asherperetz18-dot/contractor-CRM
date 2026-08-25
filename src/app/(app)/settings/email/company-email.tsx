"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveCompanyEmail,
  clearCompanyEmail,
  getCompanyEmailStatus,
  type CompanyEmailStatus,
} from "@/lib/actions/email-admin";

/**
 * Where a contractor sets the address their estimates and portal links
 * send from.
 *
 * Every company shared one platform sender until this existed -- a Smart
 * HVAC customer's estimate email showed up from La Home Contractor, the
 * platform's original tenant. The Resend API key is optional: one Resend
 * account can send from every domain it has verified, so a company can
 * set just its own address and still use the platform's key, or bring a
 * fully separate account for complete independence.
 */
export function CompanyEmail() {
  const router = useRouter();
  const [status, setStatus] = useState<CompanyEmailStatus | null>(null);
  const [fromAddress, setFromAddress] = useState("");
  const [fromName, setFromName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await getCompanyEmailStatus();
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
      const res = await saveCompanyEmail({ fromAddress, fromName, apiKey });
      if (res.error) return setError(res.error);
      setApiKey("");
      setEditing(false);
      setNote("Connected.");
      setStatus(await getCompanyEmailStatus());
      router.refresh();
    });
  }

  function disconnect() {
    setError(null);
    startTransition(async () => {
      const res = await clearCompanyEmail();
      if (res.error) return setError(res.error);
      setNote("Disconnected — this company falls back to the platform sender.");
      setStatus(await getCompanyEmailStatus());
      router.refresh();
    });
  }

  return (
    <section className="est-pay">
      <div className="est-pay-head">
        <div>
          <h2 className="est-pay-title">This company&apos;s email sender</h2>
          <p className="est-pay-sub">
            Estimate and portal-link emails go out from this address, so customers see this
            company, not the platform default.
          </p>
        </div>
        {status.connected && !editing && (
          <div className="est-pay-actions">
            <button className="btn-ghost" onClick={() => setEditing(true)} disabled={pending}>
              Replace
            </button>
            <button className="btn-ghost" onClick={disconnect} disabled={pending}>
              Disconnect
            </button>
          </div>
        )}
      </div>

      {error && <p className="error-note">{error}</p>}
      {note && <p className="hint-note">{note}</p>}

      {status.connected && !editing ? (
        <ul className="pp-checks">
          <li>
            Sending as{" "}
            <strong>
              {status.fromName ? `${status.fromName} <${status.fromAddress}>` : status.fromAddress}
            </strong>
            {status.connectedAt
              ? `, connected ${new Date(status.connectedAt).toLocaleDateString("en-US")}`
              : ""}
            .
          </li>
          <li>
            {status.hasOwnApiKey
              ? "Sending through this company's own Resend account."
              : "Sending through the platform's Resend account — the domain on that address must be verified there."}
          </li>
        </ul>
      ) : (
        <>
          {!status.connected && !status.platformFallbackAvailable && (
            <p className="error-note">
              No platform email is configured either, so a Resend API key is required below, not
              optional.
            </p>
          )}
          <label className="field">
            <span className="field-label">From address</span>
            <input
              className="est-title-input"
              placeholder="estimates@smarthvacsystem.com"
              value={fromAddress}
              onChange={(e) => setFromAddress(e.target.value)}
              disabled={pending}
            />
          </label>
          <label className="field">
            <span className="field-label">From name</span>
            <input
              className="est-title-input"
              placeholder="Smart HVAC System"
              value={fromName}
              onChange={(e) => setFromName(e.target.value)}
              disabled={pending}
            />
          </label>

          <button
            className="btn-ghost"
            onClick={() => setShowApiKey((v) => !v)}
            type="button"
          >
            {showApiKey ? "Hide" : "Add"} a dedicated Resend API key (optional)
          </button>
          {showApiKey && (
            <label className="field">
              <span className="field-label">Resend API Key</span>
              <input
                className="est-title-input"
                type="password"
                autoComplete="off"
                placeholder="re_…"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                disabled={pending}
              />
            </label>
          )}
          {!status.encryptionReady && showApiKey && (
            <p className="error-note">
              Credential encryption isn&apos;t configured on the server. Set{" "}
              <code>APP_ENCRYPTION_KEY</code> and redeploy before adding a key.
            </p>
          )}

          <div className="est-pay-actions">
            <button
              className="btn-primary"
              onClick={save}
              disabled={pending || !fromAddress.trim()}
            >
              {pending ? "Saving…" : "Connect"}
            </button>
            {editing && (
              <button className="btn-ghost" onClick={() => setEditing(false)} disabled={pending}>
                Cancel
              </button>
            )}
          </div>
        </>
      )}

      <div className="pp-webhook-url">
        <p className="est-tax-note">
          The domain on the From address must be verified for whichever Resend account actually
          sends it — the platform&apos;s account if no dedicated key is set above, or this
          company&apos;s own account if one is. An unverified domain gets the send rejected, not
          silently sent from somewhere else.
        </p>
      </div>
    </section>
  );
}
