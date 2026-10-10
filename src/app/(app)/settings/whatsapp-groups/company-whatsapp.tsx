"use client";

import { useEffect, useState, useTransition } from "react";
import {
  connectWhatsApp,
  disconnectWhatsApp,
  getWhatsAppStatus,
  type WhatsAppStatus,
} from "@/lib/actions/whatsapp-groups";
import { Field } from "@/components/ui/field";

export function CompanyWhatsApp() {
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [apiToken, setApiToken] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    getWhatsAppStatus().then((s) => {
      setStatus(s);
      setLoaded(true);
    });
  }, []);

  function connect() {
    setError("");
    setNote("");
    startTransition(async () => {
      const res = await connectWhatsApp({ apiToken });
      if (res.error) return setError(res.error);
      setApiToken("");
      setNote(
        "Connected. New messages in the bot number's groups now reach the CRM. Next: link each group to its project from the project's 💬 WhatsApp chip."
      );
      setStatus(await getWhatsAppStatus());
    });
  }

  function disconnect() {
    if (!confirm("Disconnect the project bot number? New group messages will stop reaching the CRM until it's reconnected.")) {
      return;
    }
    setError("");
    setNote("");
    startTransition(async () => {
      const res = await disconnectWhatsApp();
      if (res.error) return setError(res.error);
      setStatus(await getWhatsAppStatus());
      setNote("Disconnected. Messages and photos already saved stay on their projects.");
    });
  }

  if (!loaded) return <p className="empty-hint">Loading…</p>;
  if (!status) return <p className="error-note">Office or Admin only.</p>;

  if (status.migrationMissing) {
    return (
      <div className="dash-panel" style={{ maxWidth: 620 }}>
        <p className="error-note">
          One database step is left: run supabase/migrations/0228_whatsapp_groups.sql in the Supabase SQL editor,
          then reload this page.
        </p>
      </div>
    );
  }

  return (
    <div className="dash-panel" style={{ maxWidth: 620 }}>
      {status.connected ? (
        <>
          <p>
            <strong>Connected</strong>
            {status.phone ? ` — +${status.phone}` : ""}
            {status.connectedAt && (
              <span className="est-tax-note"> since {new Date(status.connectedAt).toLocaleDateString()}</span>
            )}
          </p>
          <p className="module-sub" style={{ margin: "6px 0 12px" }}>
            Add this number to a project&apos;s WhatsApp group, then open the project in Projects and use its
            💬 WhatsApp chip to link the group. Texts show on the project; photos go into its Photos, videos and
            documents into its files. Linking a group also brings in its last 100 messages.
          </p>
          <div className="form-row">
            <button className="btn-ghost" onClick={disconnect} disabled={pending}>
              {pending ? "Working…" : "Disconnect"}
            </button>
          </div>
        </>
      ) : (
        <>
          <ol className="module-sub" style={{ margin: "0 0 12px", paddingLeft: 20, display: "grid", gap: 6, listStyle: "decimal" }}>
            <li>
              Get a <strong>second phone number</strong> with WhatsApp for this — the project bot. Never use your main
              business number.
            </li>
            <li>
              Sign up at whapi.cloud, create a channel, and scan its QR code with the bot phone (WhatsApp › Linked
              devices).
            </li>
            <li>Copy the channel&apos;s API token from Whapi and paste it below.</li>
          </ol>
          <p className="hint-note" style={{ marginBottom: 12 }}>
            Whapi isn&apos;t an official WhatsApp service, and WhatsApp can block a number it thinks is automated. The
            bot only listens, which keeps that risk low — and if the number is ever blocked, everything already saved
            stays in the CRM. Tell each group it&apos;s saved to the project file (a line in the group description is
            enough). The token is stored encrypted, like your Twilio key.
          </p>
          {!status.encryptionReady && (
            <p className="error-note">
              APP_ENCRYPTION_KEY is not configured on the server, so keys can&apos;t be stored safely yet.
            </p>
          )}
          <div className="form-grid">
            <Field label="Whapi API token">
              <input
                type="password"
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                placeholder="From the channel's page on whapi.cloud"
                autoComplete="off"
              />
            </Field>
          </div>
          <button
            className="btn-primary"
            onClick={connect}
            disabled={pending || !status.encryptionReady || !apiToken.trim()}
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
