"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Field } from "@/components/ui/field";
import { saveMetaConfig, type MetaConfigInput } from "@/lib/actions/settings";

function randomToken() {
  return crypto.randomUUID().replace(/-/g, "");
}

export function MetaSettings({
  config,
  origin,
}: {
  config: MetaConfigInput;
  origin: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [form, setForm] = useState(config);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);

  const set = <K extends keyof MetaConfigInput>(k: K, v: MetaConfigInput[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setSaved(false);
  };

  async function handleSave() {
    setPending(true);
    await saveMetaConfig(form);
    setPending(false);
    setSaved(true);
    startTransition(() => router.refresh());
  }

  const webhookUrl = `${origin}/api/meta/leadgen`;

  return (
    <div>
      <div className="ur-breadcrumb">
        <Link href="/settings" className="ur-crumb-link">
          ⚙ Settings
        </Link>
        <span> › </span>
        <span>Facebook Lead Ads</span>
      </div>

      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Facebook Lead Ads</h1>
          <p className="module-sub">
            Auto-import leads from Facebook/Instagram Lead Ads
          </p>
        </div>
      </div>

      <div className="cp-card">
        <div className="cp-card-head">📘 Setup (done in Meta&apos;s dashboard)</div>
        <p className="cp-card-sub">
          This part happens on Meta&apos;s side, at{" "}
          <span className="mono">developers.facebook.com</span> — I can&apos;t
          do it for you, but here&apos;s exactly what&apos;s needed:
        </p>
        <ol className="settings-stage-list" style={{ listStyle: "decimal", paddingLeft: 18 }}>
          <li>Create (or open) a Business-type App in Meta for Developers.</li>
          <li>
            Add the <strong>Webhooks</strong> product, subscribe to the{" "}
            <strong>Page</strong> object&apos;s <strong>leadgen</strong>{" "}
            field, using the Callback URL and Verify Token below.
          </li>
          <li>
            Generate a Page Access Token with the{" "}
            <span className="mono">leads_retrieval</span> and{" "}
            <span className="mono">pages_manage_ads</span> permissions
            (Graph API Explorer, then exchange for a long-lived token).
          </li>
          <li>
            Subscribe your Page to the app&apos;s webhook:{" "}
            <span className="mono">
              POST /&#123;page-id&#125;/subscribed_apps
            </span>{" "}
            with that access token.
          </li>
          <li>Paste the Page ID, Page Access Token, and App Secret below.</li>
        </ol>

        <div className="cp-divider" />
        <div className="cp-card-head">Callback URL</div>
        <p className="cp-card-sub mono" style={{ wordBreak: "break-all" }}>
          {webhookUrl}
        </p>

        <Field label="Verify Token">
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={form.meta_verify_token}
              onChange={(e) => set("meta_verify_token", e.target.value)}
              placeholder="Any string you choose"
            />
            <button
              type="button"
              className="btn-ghost small"
              onClick={() => set("meta_verify_token", randomToken())}
            >
              Generate
            </button>
          </div>
        </Field>
        <p className="cp-hint">
          Use this exact value as the Verify Token when setting up the
          webhook subscription in Meta&apos;s dashboard.
        </p>

        <div className="cp-divider" />
        <div className="cp-card-head">🔑 Credentials</div>
        <Field label="Page ID">
          <input
            value={form.meta_page_id}
            onChange={(e) => set("meta_page_id", e.target.value)}
          />
        </Field>
        <Field label="Page Access Token">
          <input
            type="password"
            value={form.meta_page_access_token}
            onChange={(e) => set("meta_page_access_token", e.target.value)}
          />
        </Field>
        <Field label="App Secret">
          <input
            type="password"
            value={form.meta_app_secret}
            onChange={(e) => set("meta_app_secret", e.target.value)}
          />
        </Field>
        <p className="cp-hint">
          App Secret is used to verify that incoming webhook calls really
          come from Meta. Found under App Dashboard → Settings → Basic.
        </p>

        <div className="modal-actions">
          <div>{saved && <span className="cp-saved">✓ Saved</span>}</div>
          <div>
            <button className="btn-primary" onClick={handleSave} disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
