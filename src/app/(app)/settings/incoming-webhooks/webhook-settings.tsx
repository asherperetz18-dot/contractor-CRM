"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { regenerateWebhookSecret } from "@/lib/actions/settings";

export function WebhookSettings({
  secret,
  origin,
}: {
  secret: string | null;
  origin: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);

  const url = secret ? `${origin}/api/leads/webhook?key=${secret}` : null;

  async function handleGenerate() {
    setPending(true);
    await regenerateWebhookSecret();
    setPending(false);
    startTransition(() => router.refresh());
  }

  async function handleCopy() {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Incoming Data (Webhooks)</h1>
          <p className="module-sub">
            A private URL your website, Zapier, or any system can POST to,
            to push new leads straight into the pipeline
          </p>
        </div>
      </div>

      <div className="cp-card">
        <div className="cp-card-head">📥 Webhook URL</div>
        {url ? (
          <>
            <p className="cp-card-sub" style={{ wordBreak: "break-all" }}>
              <span className="mono">{url}</span>
            </p>
            <button className="btn-ghost small" onClick={handleCopy}>
              {copied ? "Copied!" : "Copy URL"}
            </button>
            <button
              className="btn-ghost small"
              onClick={handleGenerate}
              disabled={pending}
              style={{ marginLeft: 8 }}
            >
              {pending ? "Regenerating…" : "↻ Regenerate"}
            </button>
            <p className="hint-note">
              Regenerating immediately invalidates the old URL — update
              anywhere it&apos;s in use.
            </p>
          </>
        ) : (
          <>
            <p className="cp-card-sub">
              No webhook URL yet. Generate one to start accepting leads from
              external sources.
            </p>
            <button className="btn-primary small" onClick={handleGenerate} disabled={pending}>
              {pending ? "Generating…" : "Generate Webhook URL"}
            </button>
          </>
        )}

        <div className="cp-divider" />
        <div className="cp-card-head">How to use it</div>
        <p className="cp-card-sub">
          POST form data (JSON or standard HTML form encoding) to the URL
          above. Accepted fields — all optional except at least one of
          name/phone/email:
        </p>
        <ul className="dash-list">
          <li>
            <code className="mono">name</code> or{" "}
            <code className="mono">first_name</code> /{" "}
            <code className="mono">last_name</code>
          </li>
          <li>
            <code className="mono">phone</code> ·{" "}
            <code className="mono">phone2</code> ·{" "}
            <code className="mono">phone3</code>
          </li>
          <li>
            <code className="mono">email</code>
          </li>
          <li>
            <code className="mono">address</code> ·{" "}
            <code className="mono">zip</code>
          </li>
          <li>
            <code className="mono">project_type</code>
          </li>
          <li>
            <code className="mono">message</code> (saved as notes)
          </li>
          <li>
            <code className="mono">source</code> (defaults to
            &quot;Website&quot;)
          </li>
        </ul>
        <p className="cp-card-sub">Example:</p>
        <pre
          className="mono"
          style={{
            background: "#F0EDE4",
            padding: 12,
            borderRadius: 6,
            fontSize: 12,
            overflowX: "auto",
          }}
        >
          {`curl -X POST "${url ?? "<generate a URL above>"}" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Jane Doe","phone":"555-0100","email":"jane@example.com","message":"Interested in a kitchen remodel"}'`}
        </pre>
        <p className="hint-note">
          New leads land in the &quot;Unsorted&quot; stage of your Pipeline,
          tagged with their source.
        </p>

        <div className="cp-divider" />
        <div className="cp-card-head">📞 Dialers (ViciDial web form)</div>
        <p className="cp-card-sub">
          The same URL also accepts a lead written into the link itself (a
          GET request), which is how dialer &quot;web form&quot; buttons
          send data. In ViciDial, paste this into the campaign&apos;s{" "}
          <strong>Web Form</strong> field:
        </p>
        <pre
          className="mono"
          style={{
            background: "#F0EDE4",
            padding: 12,
            borderRadius: 6,
            fontSize: 12,
            overflowX: "auto",
          }}
        >
          {`${url ?? "<generate a URL above>"}&source=Vicidial&review=1`}
        </pre>
        <p className="cp-card-sub">
          When the agent clicks WEB FORM mid-call, ViciDial fills the link
          with the caller&apos;s details (name, phones, address,
          city/state/zip, email, comments) and the agent gets a
          check-and-save form: fix anything the dialer got wrong, pick the
          project type (your own list from Settings › Project Types), add
          an estimated value and notes, then <strong>Save lead</strong>.
        </p>
        <p className="cp-card-sub">
          Drop the <code className="mono">&amp;review=1</code> to skip the
          form and save instantly on open — that variant belongs in
          ViciDial&apos;s <strong>Dispo Call URL</strong> field, where every
          dispositioned call files its lead automatically with no one there
          to press Save.
        </p>
      </div>
    </div>
  );
}
