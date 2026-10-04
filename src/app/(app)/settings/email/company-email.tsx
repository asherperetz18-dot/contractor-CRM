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
 * platform's original tenant. A company's own address now needs its own
 * Resend account, where Resend checks the company controls the domain;
 * without one, AI Build Pros sends under the company's name and replies go
 * to the company (DECISIONS #110).
 */
export function CompanyEmail() {
  const router = useRouter();
  const [status, setStatus] = useState<CompanyEmailStatus | null>(null);
  const [fromAddress, setFromAddress] = useState("");
  const [fromName, setFromName] = useState("");
  const [apiKey, setApiKey] = useState("");
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
      setNote("Connected. We sent you a test email from the new address.");
      setStatus(await getCompanyEmailStatus());
      router.refresh();
    });
  }

  function disconnect() {
    setError(null);
    startTransition(async () => {
      const res = await clearCompanyEmail();
      if (res.error) return setError(res.error);
      setNote("Disconnected. Emails now go out from AI Build Pros under this company's name.");
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
            Estimates, portal links and bulk emails go out from this company&apos;s own address,
            through its own Resend account.
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
          <li>Sending through this company&apos;s own Resend account.</li>
          <li>
            Customers&apos; replies go to <strong>{status.replyTo ?? status.fromAddress}</strong>.
          </li>
        </ul>
      ) : (
        <>
          {!status.connected && (
            <ul className="pp-checks">
              <li>
                {status.sendsAs ? (
                  <>
                    Right now customer emails go out as <strong>{status.sendsAs}</strong>, from AI
                    Build Pros.
                  </>
                ) : (
                  "Right now this company can't send email: no shared sender is configured either."
                )}
              </li>
              <li>
                {status.replyTo ? (
                  <>
                    Customers&apos; replies go to <strong>{status.replyTo}</strong>.
                  </>
                ) : (
                  <>
                    Customers&apos; replies have nowhere to go. Add your company email in{" "}
                    <a href="/settings/company-profile">Settings → Company Profile</a>.
                  </>
                )}
              </li>
            </ul>
          )}
          {status.addressWithoutAccount && !editing && (
            <p className="hint-note">
              {status.fromAddress} was saved without this company&apos;s own Resend account, so
              nothing is sent from it. Add the account&apos;s API key below to start using it.
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

          <label className="field">
            <span className="field-label">Resend API key (this company&apos;s own account)</span>
            <input
              className="est-title-input"
              type="password"
              autoComplete="new-password"
              data-1p-ignore
              data-lpignore="true"
              placeholder={status.hasOwnApiKey ? "Saved — leave blank to keep it" : "re_…"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              disabled={pending}
            />
          </label>
          {!status.encryptionReady && (
            <p className="error-note">
              Credential encryption isn&apos;t configured on the server. Set{" "}
              <code>APP_ENCRYPTION_KEY</code> and redeploy before adding a key.
            </p>
          )}

          <div className="est-pay-actions">
            <button
              className="btn-primary"
              onClick={save}
              disabled={pending || !fromAddress.trim() || (!apiKey.trim() && !status.hasOwnApiKey)}
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
          Resend only sends from a domain verified in your own Resend account (Domains → Add
          domain, then add the DNS records it shows). When you click Connect, we send you a test
          email from the new address. If Resend refuses it, nothing is saved.
        </p>
      </div>
    </section>
  );
}
