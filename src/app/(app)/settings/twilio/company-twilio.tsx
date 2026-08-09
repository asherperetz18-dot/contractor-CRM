"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveCompanyTwilio,
  clearCompanyTwilio,
  getCompanyTwilioStatus,
  type CompanyTwilioStatus,
} from "@/lib/actions/twilio-admin";

/**
 * Where a contractor connects their own Twilio account.
 *
 * The auth token is write-only, like the Stripe secret: stored sealed and
 * never sent back to a browser.
 */
export function CompanyTwilio() {
  const router = useRouter();
  const [status, setStatus] = useState<CompanyTwilioStatus | null>(null);
  const [accountSid, setAccountSid] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [apiKeySid, setApiKeySid] = useState("");
  const [apiKeySecret, setApiKeySecret] = useState("");
  const [twimlAppSid, setTwimlAppSid] = useState("");
  const [showVoice, setShowVoice] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await getCompanyTwilioStatus();
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
      const res = await saveCompanyTwilio({
        accountSid,
        authToken,
        phoneNumber,
        apiKeySid,
        apiKeySecret,
        twimlAppSid,
      });
      if (res.error) return setError(res.error);
      setAuthToken("");
      setApiKeySecret("");
      setEditing(false);
      setNote("Connected.");
      setStatus(await getCompanyTwilioStatus());
      router.refresh();
    });
  }

  function disconnect() {
    setError(null);
    startTransition(async () => {
      const res = await clearCompanyTwilio();
      if (res.error) return setError(res.error);
      setNote("Disconnected — this company falls back to the platform number.");
      setStatus(await getCompanyTwilioStatus());
      router.refresh();
    });
  }

  const copy = (value: string, which: string) => {
    navigator.clipboard.writeText(value);
    setCopied(which);
    setTimeout(() => setCopied(""), 2000);
  };

  return (
    <section className="est-pay">
      <div className="est-pay-head">
        <div>
          <h2 className="est-pay-title">This company&apos;s Twilio account</h2>
          <p className="est-pay-sub">
            Texts and calls go out on this number, and replies come back to this company only.
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

      {!status.encryptionReady && (
        <p className="error-note">
          Credential encryption isn&apos;t configured on the server. Set{" "}
          <code>APP_ENCRYPTION_KEY</code> and redeploy.
        </p>
      )}
      {error && <p className="error-note">{error}</p>}
      {note && <p className="hint-note">{note}</p>}

      {status.connected && !editing ? (
        <ul className="pp-checks">
          <li>
            Sending from <strong>{status.phoneNumber}</strong> on account{" "}
            <span className="mono">{status.accountSid}</span>
            {status.connectedAt
              ? `, connected ${new Date(status.connectedAt).toLocaleDateString("en-US")}`
              : ""}
            .
          </li>
          <li>
            In-app calling {status.hasVoice ? "is configured" : "is not configured (SMS only)"}.
          </li>
        </ul>
      ) : (
        <>
          <label className="field">
            <span className="field-label">Account SID</span>
            <input
              className="est-title-input"
              placeholder="AC…"
              value={accountSid}
              onChange={(e) => setAccountSid(e.target.value)}
              disabled={pending || !status.encryptionReady}
            />
          </label>
          <label className="field">
            <span className="field-label">Auth token</span>
            <input
              className="est-title-input"
              type="password"
              autoComplete="off"
              value={authToken}
              onChange={(e) => setAuthToken(e.target.value)}
              disabled={pending || !status.encryptionReady}
            />
          </label>
          <label className="field">
            <span className="field-label">Twilio phone number</span>
            <input
              className="est-title-input"
              placeholder="(818) 555-0100"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              disabled={pending || !status.encryptionReady}
            />
          </label>

          <button className="btn-ghost" onClick={() => setShowVoice((v) => !v)} type="button">
            {showVoice ? "Hide" : "Add"} in-app calling (optional)
          </button>
          {showVoice && (
            <>
              <label className="field">
                <span className="field-label">API Key SID</span>
                <input
                  className="est-title-input"
                  placeholder="SK…"
                  value={apiKeySid}
                  onChange={(e) => setApiKeySid(e.target.value)}
                  disabled={pending}
                />
              </label>
              <label className="field">
                <span className="field-label">API Key Secret</span>
                <input
                  className="est-title-input"
                  type="password"
                  autoComplete="off"
                  value={apiKeySecret}
                  onChange={(e) => setApiKeySecret(e.target.value)}
                  disabled={pending}
                />
              </label>
              <label className="field">
                <span className="field-label">TwiML App SID</span>
                <input
                  className="est-title-input"
                  placeholder="AP…"
                  value={twimlAppSid}
                  onChange={(e) => setTwimlAppSid(e.target.value)}
                  disabled={pending}
                />
              </label>
            </>
          )}

          <div className="est-pay-actions">
            <button
              className="btn-primary"
              onClick={save}
              disabled={
                pending || !accountSid.trim() || !authToken.trim() || !phoneNumber.trim() ||
                !status.encryptionReady
              }
            >
              {pending ? "Saving…" : "Connect Twilio"}
            </button>
            {editing && (
              <button className="btn-ghost" onClick={() => setEditing(false)} disabled={pending}>
                Cancel
              </button>
            )}
          </div>
        </>
      )}

      {/* Shared paths on purpose: inbound is routed by the number the
          message arrived on, so every company points at the same URLs. */}
      <div className="pp-webhook-url">
        <div className="field-label">Set these on the number in Twilio</div>
        <div className="pp-url-row">
          <code className="mono">{status.smsWebhookUrl}</code>
          <button className="btn-ghost" onClick={() => copy(status.smsWebhookUrl, "sms")}>
            {copied === "sms" ? "Copied" : "Copy"}
          </button>
        </div>
        <div className="pp-url-row">
          <code className="mono">{status.voiceWebhookUrl}</code>
          <button className="btn-ghost" onClick={() => copy(status.voiceWebhookUrl, "voice")}>
            {copied === "voice" ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="est-tax-note">
          In Twilio: Phone Numbers → your number → set <strong>A message comes in</strong> to the
          first URL and <strong>A call comes in</strong> to the second, both POST.
        </p>
        <p className="est-tax-note">
          Texting to US numbers also requires <strong>A2P 10DLC registration</strong> in Twilio —
          your business details and sample messages, reviewed by the carriers. Until that is
          approved, messages are filtered or blocked no matter what is configured here.
        </p>
      </div>
    </section>
  );
}
