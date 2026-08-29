"use client";

import { useEffect, useState, useTransition } from "react";
import {
  disconnectCallRail,
  getCallRailStatus,
  runCallRailBackfill,
  saveCompanyCallRail,
  type CallRailStatus,
} from "@/lib/actions/callrail-admin";
import { Field } from "@/components/ui/field";

export function CompanyCallRail() {
  const [status, setStatus] = useState<CallRailStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [accountId, setAccountId] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    getCallRailStatus().then((s) => {
      setStatus(s);
      setLoaded(true);
    });
  }, []);

  function connect() {
    setError("");
    setNote("");
    startTransition(async () => {
      const res = await saveCompanyCallRail({ apiKey, accountId });
      if (res.error) return setError(res.error);
      setApiKey("");
      setNote(
        `Connected${res.companyName ? ` to ${res.companyName}` : ""}. Calls, form fills and texts to your tracking numbers now flow into the CRM automatically.`
      );
      setStatus(await getCallRailStatus());
    });
  }

  function pullNow() {
    setError("");
    setNote("");
    startTransition(async () => {
      const res = await runCallRailBackfill();
      if (res.error) return setError(res.error);
      setNote(
        `Pulled ${res.processed} call${res.processed === 1 ? "" : "s"} from the last 3 days — ${res.created} new.`
      );
    });
  }

  function disconnect() {
    if (!confirm("Disconnect CallRail? Calls will stop flowing in until it's reconnected.")) return;
    setError("");
    setNote("");
    startTransition(async () => {
      const res = await disconnectCallRail();
      if (res.error) return setError(res.error);
      setStatus(await getCallRailStatus());
      setNote("Disconnected. The webhook in CallRail was left in place; reconnecting reuses it.");
    });
  }

  if (!loaded) return <p className="empty-hint">Loading…</p>;
  if (!status) return <p className="error-note">Admins only.</p>;

  return (
    <div className="dash-panel" style={{ maxWidth: 620 }}>
      {status.connected ? (
        <>
          <p>
            <strong>Connected</strong>
            {status.callrailCompanyName ? ` — ${status.callrailCompanyName}` : ""} (account{" "}
            {status.accountId})
            {status.connectedAt && (
              <span className="est-tax-note">
                {" "}
                since {new Date(status.connectedAt).toLocaleDateString()}
              </span>
            )}
          </p>
          <p className="module-sub" style={{ margin: "6px 0 12px" }}>
            Tracked calls land in Call Reports with their marketing source, unknown callers
            become leads in Unsorted, and a sweep every 6 hours re-pulls anything a webhook
            delivery missed.
          </p>
          <div className="form-row">
            <button className="btn-ghost" onClick={pullNow} disabled={pending}>
              {pending ? "Working…" : "Pull last 3 days now"}
            </button>
            <button className="btn-ghost" onClick={disconnect} disabled={pending}>
              Disconnect
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="module-sub" style={{ marginBottom: 12 }}>
            Paste your CallRail API key and account id. Connecting verifies the key,
            finds your CallRail company, and registers the webhooks automatically —
            nothing to configure on CallRail&apos;s side. The key is stored encrypted, like
            your Twilio and Stripe keys.
          </p>
          {!status.encryptionReady && (
            <p className="error-note">
              APP_ENCRYPTION_KEY is not configured on the server, so keys can&apos;t be stored
              safely yet.
            </p>
          )}
          <div className="form-grid">
            <Field label="API key">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="From CallRail: Settings → Integrations → API Keys"
                autoComplete="off"
              />
            </Field>
            <Field label="Account id">
              <input
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                placeholder="9 digits, after /a/ in the dashboard URL"
                inputMode="numeric"
              />
            </Field>
          </div>
          <button
            className="btn-primary"
            onClick={connect}
            disabled={pending || !status.encryptionReady}
          >
            {pending ? "Connecting…" : "Connect CallRail"}
          </button>
        </>
      )}

      {error && <p className="error-note">{error}</p>}
      {note && !error && <p className="hint-note">{note}</p>}
    </div>
  );
}
