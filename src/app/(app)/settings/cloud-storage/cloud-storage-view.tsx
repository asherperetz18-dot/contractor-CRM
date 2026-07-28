"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { disconnectGoogleDrive } from "@/lib/actions/google-drive";

export function CloudStorageView({
  connected,
  email,
  connectError,
}: {
  connected: boolean;
  email?: string;
  connectError?: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(connectError ?? "");

  async function handleDisconnect() {
    if (!confirm("Disconnect Google Drive? New file uploads will go back to this app's storage.")) {
      return;
    }
    setPending(true);
    setError("");
    const result = await disconnectGoogleDrive();
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div>
      <div className="ur-breadcrumb">
        <Link href="/settings" className="ur-crumb-link">
          ⚙ Settings
        </Link>
        <span> › </span>
        <span>Cloud Storage</span>
      </div>

      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Cloud Storage</h1>
          <p className="module-sub">
            Connect Google Drive so lead file attachments upload there instead of this app&apos;s
            storage
          </p>
        </div>
      </div>

      {error && <p className="error-note">{error}</p>}

      <div className="second-contact-block" style={{ maxWidth: 480 }}>
        <div className="second-contact-head">
          <span>Google Drive</span>
          {connected && <Badge color="#2F855A">Connected</Badge>}
        </div>

        {connected ? (
          <>
            <p className="hint-note" style={{ marginTop: 0 }}>
              Connected as <strong>{email}</strong>. New lead file uploads go into a &quot;Contractor
              CRM Files&quot; folder in this Google Drive account.
            </p>
            <button
              type="button"
              className="btn-danger-ghost"
              onClick={handleDisconnect}
              disabled={pending}
            >
              {pending ? "Disconnecting…" : "Disconnect"}
            </button>
          </>
        ) : (
          <>
            <p className="hint-note" style={{ marginTop: 0 }}>
              Not connected. Lead file uploads currently go into this app&apos;s built-in storage.
            </p>
            <a href="/api/oauth/google-drive/authorize" className="btn-primary">
              Connect Google Drive
            </a>
          </>
        )}
      </div>
    </div>
  );
}
