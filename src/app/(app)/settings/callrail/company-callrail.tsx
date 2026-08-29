"use client";

import { useEffect, useState, useTransition } from "react";
import {
  disconnectCallRail,
  getCallRailStatus,
  listCallRailCompanies,
  runCallRailBackfill,
  saveCompanyCallRail,
  type CallRailCompanyOption,
  type CallRailStatus,
} from "@/lib/actions/callrail-admin";
import { Field } from "@/components/ui/field";

export function CompanyCallRail() {
  const [status, setStatus] = useState<CallRailStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [accountId, setAccountId] = useState("");
  // The picker: one CallRail account tracks several brands, and only
  // the admin knows which of them belong in THIS CRM company.
  const [options, setOptions] = useState<CallRailCompanyOption[] | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    getCallRailStatus().then((s) => {
      setStatus(s);
      setLoaded(true);
    });
  }, []);

  function loadCompanies(useStoredKey: boolean) {
    setError("");
    setNote("");
    startTransition(async () => {
      const res = await listCallRailCompanies(
        useStoredKey ? undefined : { apiKey, accountId }
      );
      if (res.error || !res.companies) return setError(res.error ?? "Couldn't load companies.");
      setAccountId(res.accountId ?? accountId);
      setOptions(res.companies);
      // Default everything on -- unticking is a decision, missing calls
      // by default is a trap.
      setChecked(Object.fromEntries(res.companies.map((c) => [c.id, true])));
    });
  }

  function connect() {
    if (!options) return;
    setError("");
    setNote("");
    startTransition(async () => {
      const chosen = options.filter((c) => checked[c.id]);
      const res = await saveCompanyCallRail({
        apiKey: apiKey || undefined,
        accountId,
        companies: chosen,
      });
      if (res.error) return setError(res.error);
      setApiKey("");
      setOptions(null);
      setNote(
        `Connected ${chosen.length} compan${chosen.length === 1 ? "y" : "ies"}. Calls, form fills and texts now flow in automatically — use "Pull last 3 days now" to bring in recent history.`
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
      setOptions(null);
      setNote("Disconnected. The webhooks in CallRail were left in place; reconnecting reuses them.");
    });
  }

  if (!loaded) return <p className="empty-hint">Loading…</p>;
  if (!status) return <p className="error-note">Admins only.</p>;

  const picker = options && (
    <div style={{ margin: "10px 0" }}>
      <p className="module-sub" style={{ marginBottom: 6 }}>
        Which CallRail companies should feed this CRM?
      </p>
      {options.map((c) => (
        <label key={c.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 0" }}>
          <input
            type="checkbox"
            checked={!!checked[c.id]}
            onChange={(e) => setChecked({ ...checked, [c.id]: e.target.checked })}
          />
          {c.name}
        </label>
      ))}
      <button
        className="btn-primary"
        style={{ marginTop: 8 }}
        onClick={connect}
        disabled={pending || !options.some((c) => checked[c.id])}
      >
        {pending ? "Connecting…" : "Connect selected"}
      </button>
    </div>
  );

  return (
    <div className="dash-panel" style={{ maxWidth: 620 }}>
      {status.connected ? (
        <>
          <p>
            <strong>Connected</strong> — account {status.accountId}
            {status.connectedAt && (
              <span className="est-tax-note">
                {" "}
                since {new Date(status.connectedAt).toLocaleDateString()}
              </span>
            )}
          </p>
          {status.companyNames.length > 0 && (
            <p className="module-sub" style={{ margin: "4px 0 0" }}>
              Tracking: {status.companyNames.join(", ")}
            </p>
          )}
          <p className="module-sub" style={{ margin: "6px 0 12px" }}>
            Tracked calls land in Call Reports with their marketing source, unknown callers
            become leads in Unsorted, and a sweep every 6 hours re-pulls anything a webhook
            delivery missed.
          </p>
          {picker}
          {!options && (
            <div className="form-row">
              <button className="btn-ghost" onClick={pullNow} disabled={pending}>
                {pending ? "Working…" : "Pull last 3 days now"}
              </button>
              <button className="btn-ghost" onClick={() => loadCompanies(true)} disabled={pending}>
                Choose companies…
              </button>
              <button className="btn-ghost" onClick={disconnect} disabled={pending}>
                Disconnect
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="module-sub" style={{ marginBottom: 12 }}>
            Paste your CallRail API key and account id, load the companies in the account,
            and pick which ones feed this CRM. Webhooks are registered automatically —
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
                placeholder="From CallRail: Settings → API Keys (allow writes)"
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
          {picker ?? (
            <button
              className="btn-primary"
              onClick={() => loadCompanies(false)}
              disabled={pending || !status.encryptionReady}
            >
              {pending ? "Loading…" : "Load companies"}
            </button>
          )}
        </>
      )}

      {error && <p className="error-note">{error}</p>}
      {note && !error && <p className="hint-note">{note}</p>}
    </div>
  );
}
