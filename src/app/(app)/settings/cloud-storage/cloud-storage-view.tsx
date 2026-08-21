"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { disconnectGoogleDrive } from "@/lib/actions/google-drive";
import { backupFilesToDrive } from "@/lib/actions/lead-files";
import type { DriveCategoryStat } from "./page";

export function CloudStorageView({
  connected,
  email,
  expired,
  connectError,
  categories,
}: {
  connected: boolean;
  email?: string;
  expired?: boolean;
  connectError?: string;
  categories?: DriveCategoryStat[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(connectError ?? "");
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupNote, setBackupNote] = useState("");

  /**
   * Walks the whole history in batches: the action moves twenty files
   * per call, and this keeps calling until it reports nothing left --
   * a company's entire archive will not fit one server invocation.
   */
  async function handleBackup() {
    setBackupBusy(true);
    setError("");
    setBackupNote("Backing up…");
    let movedTotal = 0;
    let shortcutTotal = 0;
    let docsTotal = 0;
    for (let round = 0; round < 200; round++) {
      const res = await backupFilesToDrive();
      if (res.error) {
        setError(res.error);
        setBackupBusy(false);
        return;
      }
      movedTotal += res.moved ?? 0;
      shortcutTotal += res.shortcutted ?? 0;
      docsTotal += res.docsSynced ?? 0;
      const remaining = res.remaining ?? 0;
      setBackupNote(
        `Backing up… ${movedTotal} files moved, ${shortcutTotal} shortcuts filed, ${docsTotal} documents rendered to PDF, ${remaining} to go`
      );
      if (
        remaining === 0 ||
        ((res.moved ?? 0) === 0 && (res.shortcutted ?? 0) === 0 && (res.docsSynced ?? 0) === 0 && round > 0)
      )
        break;
    }
    setBackupNote(
      `Done — ${movedTotal} file${movedTotal === 1 ? "" : "s"} moved to Drive, ${shortcutTotal} shortcuts filed, ${docsTotal} document${docsTotal === 1 ? "" : "s"} rendered as PDFs into Contracts/Proposals.`
    );
    setBackupBusy(false);
  }

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
          {connected && !expired && <Badge color="#2F855A">Connected</Badge>}
          {connected && expired && <Badge color="#B7791F">Connection expired</Badge>}
        </div>

        {connected && expired ? (
          <>
            <p className="hint-note" style={{ marginTop: 0 }}>
              Google no longer accepts this connection for <strong>{email}</strong> — uploads
              are going to this app&apos;s storage instead. Reconnect below. If this keeps
              happening every week, the Google Cloud OAuth app is in &quot;Testing&quot; mode:
              publish it to Production (Google Cloud Console → APIs &amp; Services → OAuth
              consent screen → Publish app) and reconnect once more.
            </p>
            <a href="/api/oauth/google-drive/authorize" className="btn-primary">
              Reconnect Google Drive
            </a>
          </>
        ) : connected ? (
          <>
            <p className="hint-note" style={{ marginTop: 0 }}>
              Connected as <strong>{email}</strong>. New lead file uploads go into a &quot;Contractor
              CRM Files&quot; folder in this Google Drive account.
            </p>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn-primary"
                onClick={handleBackup}
                disabled={backupBusy || pending}
              >
                {backupBusy ? "Backing up…" : "Back up existing files to Drive"}
              </button>
              <button
                type="button"
                className="btn-danger-ghost"
                onClick={handleDisconnect}
                disabled={pending || backupBusy}
              >
                {pending ? "Disconnecting…" : "Disconnect"}
              </button>
            </div>
            {backupNote && <p className="hint-note">{backupNote}</p>}
            <p className="hint-note">
              Files land in each contact&apos;s folder, with shortcuts collected under
              &quot;Photos&quot; and &quot;Documents&quot; so you can also browse by type.
            </p>
            {!!categories?.length && (
              <div className="drive-cat-grid">
                {categories.map((c) => {
                  const pct = c.total ? Math.round((c.synced / c.total) * 100) : 100;
                  return (
                    <div key={c.name} className="drive-cat-card">
                      <div className="drive-cat-name">{c.name}</div>
                      <div className="drive-cat-count">
                        <strong>{c.synced}</strong> / {c.total}
                      </div>
                      {c.syncedBytes > 0 && (
                        <div className="drive-cat-bytes">
                          {(c.syncedBytes / 1024 / 1024).toFixed(1)} MB synced
                        </div>
                      )}
                      <div className="drive-cat-bar">
                        <div className="drive-cat-bar-fill" style={{ width: pct + "%" }} />
                      </div>
                      <div className="drive-cat-pct">{pct}% synced</div>
                    </div>
                  );
                })}
              </div>
            )}
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
