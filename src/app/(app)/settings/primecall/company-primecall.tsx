"use client";

import { useEffect, useState, useTransition } from "react";
import {
  connectPrimeCall,
  disconnectPrimeCall,
  getPrimeCallStatus,
  listPrimeCallExtensions,
  runPrimeCallSync,
  type PrimeCallExtension,
  type PrimeCallStatus,
} from "@/lib/actions/primecall-admin";
import { Field } from "@/components/ui/field";

export function CompanyPrimeCall() {
  const [status, setStatus] = useState<PrimeCallStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [server, setServer] = useState("");
  const [domain, setDomain] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [extensions, setExtensions] = useState<PrimeCallExtension[] | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    getPrimeCallStatus().then((s) => {
      setStatus(s);
      setLoaded(true);
      if (s?.connected) {
        listPrimeCallExtensions().then((r) => setExtensions(r.extensions ?? null));
      }
    });
  }, []);

  function connect() {
    setError("");
    setNote("");
    startTransition(async () => {
      const res = await connectPrimeCall({ server, domain, apiKey });
      if (res.error) return setError(res.error);
      setApiKey("");
      setNote(
        res.liveFeed
          ? 'Connected. Calls now arrive within seconds of hanging up — use "Pull last 24 hours now" to bring in today\'s calls.'
          : 'Connected. PrimeCall didn\'t allow a live feed on this account, so calls arrive within 15 minutes. Ask PrimeCall to enable "event subscriptions" for instant delivery, then reconnect.'
      );
      setStatus(await getPrimeCallStatus());
      const ext = await listPrimeCallExtensions();
      setExtensions(ext.extensions ?? null);
    });
  }

  function pullNow() {
    setError("");
    setNote("");
    startTransition(async () => {
      const res = await runPrimeCallSync();
      if (res.error) return setError(res.error);
      setNote(
        `Pulled ${res.processed} call${res.processed === 1 ? "" : "s"} from the last 24 hours — ${res.created} new.`
      );
    });
  }

  function disconnect() {
    if (!confirm("Disconnect PrimeCall? Calls will stop arriving in the CRM until it's reconnected.")) return;
    setError("");
    setNote("");
    startTransition(async () => {
      const res = await disconnectPrimeCall();
      if (res.error) return setError(res.error);
      setStatus(await getPrimeCallStatus());
      setExtensions(null);
      setNote("Disconnected. Calls already filed stay in Call Reports.");
    });
  }

  if (!loaded) return <p className="empty-hint">Loading…</p>;
  if (!status) return <p className="error-note">Admins only.</p>;

  if (status.migrationMissing) {
    return (
      <div className="dash-panel" style={{ maxWidth: 620 }}>
        <p className="error-note">
          One database step is left: run supabase/migrations/0177_primecall.sql in the Supabase SQL
          editor, then reload this page.
        </p>
      </div>
    );
  }

  return (
    <div className="dash-panel" style={{ maxWidth: 620 }}>
      {status.connected ? (
        <>
          <p>
            <strong>Connected</strong> — {status.domain} on {status.server?.replace(/^https:\/\//, "")}
            {status.connectedAt && (
              <span className="est-tax-note">
                {" "}
                since {new Date(status.connectedAt).toLocaleDateString()}
              </span>
            )}
          </p>
          <p className="module-sub" style={{ margin: "6px 0 12px" }}>
            {status.liveFeed
              ? "Calls arrive within seconds of hanging up"
              : "Calls arrive within 15 minutes (PrimeCall's live feed isn't on for this account)"}
            . Callers nobody has become leads in Unsorted, calls to and from existing contacts land
            on their card, and recordings play right in Call Reports.
          </p>
          <div className="form-row">
            <button className="btn-ghost" onClick={pullNow} disabled={pending}>
              {pending ? "Working…" : "Pull last 24 hours now"}
            </button>
            <button className="btn-ghost" onClick={disconnect} disabled={pending}>
              Disconnect
            </button>
          </div>

          {extensions && extensions.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <p className="module-sub" style={{ marginBottom: 6 }}>
                Extensions — a call is credited to the CRM user whose email matches the
                extension&apos;s email in PrimeCall.
              </p>
              {extensions.map((x) => (
                <div
                  key={x.extension}
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "2px 10px",
                    padding: "6px 0",
                    borderTop: "1px solid var(--line)",
                  }}
                >
                  <strong style={{ minWidth: 48 }}>{x.extension}</strong>
                  <span style={{ flex: "1 1 140px" }}>{x.name || x.email || "—"}</span>
                  <span className="est-tax-note" style={{ flex: "1 1 180px" }}>
                    {x.crmUser
                      ? `→ ${x.crmUser}`
                      : x.email
                        ? `Not linked — no single CRM user has ${x.email}`
                        : "Not linked — no email on this extension"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <p className="module-sub" style={{ marginBottom: 12 }}>
            Ask PrimeCall support for an API key with Office Manager access, your server address and
            your domain. The live call feed is set up automatically — nothing to configure on
            PrimeCall&apos;s side. The key is stored encrypted, like your Twilio and CallRail keys.
          </p>
          {!status.encryptionReady && (
            <p className="error-note">
              APP_ENCRYPTION_KEY is not configured on the server, so keys can&apos;t be stored
              safely yet.
            </p>
          )}
          <div className="form-grid">
            <Field label="Server address">
              <input
                value={server}
                onChange={(e) => setServer(e.target.value)}
                placeholder="e.g. portal.primecall.com"
                autoComplete="off"
              />
            </Field>
            <Field label="Domain">
              <input
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="Your company's account name in PrimeCall"
                autoComplete="off"
              />
            </Field>
            <Field label="API key">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="From PrimeCall support"
                autoComplete="off"
              />
            </Field>
          </div>
          <button
            className="btn-primary"
            onClick={connect}
            disabled={pending || !status.encryptionReady || !server || !domain || !apiKey}
          >
            {pending ? "Connecting…" : "Connect"}
          </button>
        </>
      )}

      {error && <p className="error-note">{error}</p>}
      {note && !error && <p className="hint-note">{note}</p>}
    </div>
  );
}
