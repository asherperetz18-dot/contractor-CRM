"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import {
  cancelFacebookPagePick,
  connectFacebookPage,
  disconnectFacebookPage,
  type FacebookLeadAdsStatus,
} from "@/lib/actions/facebook-lead-ads";

const CONNECT_HREF = "/api/oauth/meta/authorize";

function when(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** A sign-in that came back with several Pages: which one runs the lead forms? */
function PagePicker({ pages }: { pages: { id: string; name: string }[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [picked, setPicked] = useState(pages[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function connect() {
    setBusy(true);
    setError("");
    const res = await connectFacebookPage(picked);
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    startTransition(() => router.replace("/settings/facebook-lead-ads?connected=1"));
  }

  async function cancel() {
    await cancelFacebookPagePick();
    startTransition(() => router.replace("/settings/facebook-lead-ads"));
  }

  return (
    <div className="cp-card fbl-card">
      <div className="cp-card-head">Which Page runs your lead forms?</div>
      <p className="cp-card-sub">
        Your Facebook account manages {pages.length} Pages. Leads from the one you pick will arrive in Contacts &amp;
        Leads.
      </p>
      <div className="fbl-pages" role="radiogroup" aria-label="Facebook Page">
        {pages.map((p) => (
          <label key={p.id} className={`fbl-page${picked === p.id ? " is-picked" : ""}`}>
            <input type="radio" name="fbl-page" value={p.id} checked={picked === p.id} onChange={() => setPicked(p.id)} />
            <span>{p.name}</span>
          </label>
        ))}
      </div>
      <div className="fbl-actions">
        <button type="button" className="btn-primary" onClick={connect} disabled={busy || !picked}>
          {busy ? "Connecting…" : "Connect this Page"}
        </button>
        <button type="button" className="btn-ghost" onClick={cancel} disabled={busy}>
          Cancel
        </button>
      </div>
      {error && <p className="error-note">{error}</p>}
    </div>
  );
}

export function FacebookConnect({ status }: { status: FacebookLeadAdsStatus }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (status.pickable && status.pickable.length > 0) return <PagePicker pages={status.pickable} />;

  const conn = status.connection?.via === "facebook_login" ? status.connection : null;
  const disabled = !status.configured || status.migrationMissing;

  async function disconnect() {
    if (
      !window.confirm(
        `Disconnect ${conn?.pageName ?? "this Page"}? New Facebook leads will stop arriving in the CRM. Leads already here stay.`
      )
    ) {
      return;
    }
    setBusy(true);
    setError("");
    const res = await disconnectFacebookPage();
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div className="cp-card fbl-card">
      <div className="fbl-head">
        <div className="cp-card-head">Connect with Facebook</div>
        {conn && conn.health.ok && <Badge color="#2F855A">Connected</Badge>}
        {conn && !conn.health.ok && <Badge color="#B7791F">Reconnect needed</Badge>}
      </div>

      {conn ? (
        <>
          <p className="fbl-status">
            Leads from <strong>{conn.pageName ?? `Page ${conn.pageId}`}</strong> arrive in Contacts &amp; Leads as
            Unsorted, with the source “Facebook Lead Ads”.
            {conn.connectedAt && <> Connected {when(conn.connectedAt)}.</>}
          </p>
          {!conn.health.ok && <p className="error-note">{conn.health.problem}</p>}
          <div className="fbl-actions">
            <a href={CONNECT_HREF} className={conn.health.ok ? "btn-ghost" : "btn-primary"}>
              {conn.health.ok ? "Switch Page" : "Reconnect"}
            </a>
            <button type="button" className="btn-danger-ghost" onClick={disconnect} disabled={busy}>
              {busy ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="cp-card-sub">
            Sign in with the Facebook account that manages your business Page — through Business Manager is fine —
            and pick the Page your lead forms run on. The CRM does the rest: no tokens to copy, and it tells you here
            if the connection ever stops working.
          </p>
          <div className="fbl-actions">
            <a href={CONNECT_HREF} className={`btn-primary${disabled ? " is-disabled" : ""}`} aria-disabled={disabled}>
              Connect with Facebook
            </a>
          </div>
        </>
      )}
      {error && <p className="error-note">{error}</p>}
    </div>
  );
}
