"use client";

import { useEffect, useState, useTransition } from "react";
import {
  getInboundEmailStatus,
  regenerateInboundEmailToken,
  type InboundEmailStatus,
} from "@/lib/actions/inbound-email-admin";

export function InboundEmailSettings() {
  const [status, setStatus] = useState<InboundEmailStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    getInboundEmailStatus().then((s) => {
      setStatus(s);
      setLoaded(true);
    });
  }, []);

  function regenerate(firstTime: boolean) {
    if (
      !firstTime &&
      !confirm("Generate a new address? The current one stops working immediately — update every auto-forward rule that uses it.")
    )
      return;
    setError("");
    setNote("");
    startTransition(async () => {
      const res = await regenerateInboundEmailToken();
      if (res.error) return setError(res.error);
      setStatus(await getInboundEmailStatus());
      setNote(firstTime ? "Address created. Set up your auto-forwards below." : "New address active — the old one is dead.");
    });
  }

  function copy() {
    if (!status?.address) return;
    navigator.clipboard?.writeText(status.address).then(() => setNote("Copied."));
  }

  if (!loaded) return <p className="empty-hint">Loading…</p>;
  if (!status) return <p className="error-note">Admins only.</p>;

  return (
    <div className="dash-panel" style={{ maxWidth: 680 }}>
      {!status.domainReady ? (
        <p className="error-note">
          The platform&apos;s receiving domain isn&apos;t configured yet (INBOUND_EMAIL_DOMAIN).
        </p>
      ) : status.address ? (
        <>
          <p className="module-sub" style={{ marginBottom: 6 }}>
            Your company&apos;s lead intake address:
          </p>
          <p>
            <code style={{ fontSize: 15, wordBreak: "break-all" }}>{status.address}</code>
          </p>
          <div className="form-row" style={{ margin: "10px 0 16px" }}>
            <button className="btn-primary" onClick={copy} disabled={pending}>
              Copy address
            </button>
            <button className="btn-ghost" onClick={() => regenerate(false)} disabled={pending}>
              Regenerate
            </button>
          </div>
          <p className="module-sub" style={{ marginBottom: 6 }}>
            <strong>How to use it</strong> &mdash; auto-forward your lead notification emails:
          </p>
          <ul className="module-sub" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
            <li>
              <strong>Gmail:</strong> Settings &rarr; Forwarding &rarr; Add a forwarding address
              (paste the address above, confirm the verification email that lands as a lead note),
              then create a filter &mdash; e.g. from:proreferral.homedepot.com &rarr; Forward.
            </li>
            <li>
              <strong>Outlook:</strong> Settings &rarr; Rules &rarr; new rule: from the lead
              service &rarr; Redirect to the address above.
            </li>
            <li>
              Each forwarded email becomes a lead in <strong>Unsorted</strong> with the right
              source (Home Depot Pro Referral, Angi, Yelp&hellip;), and your new-lead text alerts
              fire. If the sender is already a lead, the email is added to their notes instead.
            </li>
            <li>
              Keep this address private &mdash; anyone who has it can put leads in your pipeline.
              Regenerate it if it leaks.
            </li>
          </ul>
        </>
      ) : (
        <>
          <p className="module-sub" style={{ marginBottom: 12 }}>
            Generate your company&apos;s private intake address, then auto-forward lead emails to
            it. Every forwarded email becomes a lead with the right source, and your new-lead
            alerts fire just like a website lead.
          </p>
          <button className="btn-primary" onClick={() => regenerate(true)} disabled={pending}>
            {pending ? "Creating…" : "Create my intake address"}
          </button>
        </>
      )}

      {error && <p className="error-note">{error}</p>}
      {note && !error && <p className="hint-note">{note}</p>}
    </div>
  );
}
