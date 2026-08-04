"use client";

import { useState } from "react";
import { downloadBackup } from "@/lib/actions/backup";

export function BackupView({
  counts,
  skipped,
  totalRows,
}: {
  counts: Record<string, number>;
  skipped: Record<string, string>;
  totalRows: number;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const skippedKeys = Object.keys(skipped);

  async function handleDownload() {
    setPending(true);
    setError("");
    setDone("");
    try {
      const result = await downloadBackup();
      if (result.error) {
        setError(result.error);
        return;
      }
      const blob = new Blob([result.json ?? ""], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `crm-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setDone(`Downloaded ${result.rows?.toLocaleString()} rows.`);
    } catch {
      setError("Something went wrong building the backup.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Backup &amp; Export</h1>
          <p className="module-sub">
            A full copy of your CRM data — runs automatically every night, or download one now
          </p>
        </div>
        <button className="btn-primary" onClick={handleDownload} disabled={pending}>
          {pending ? "Building…" : "⭳ Download Backup Now"}
        </button>
      </div>

      {error && <p className="error-note">{error}</p>}
      {done && <p className="cp-saved">{done}</p>}

      <div className="stat-grid">
        <div className="stat-card stat-static">
          <div className="stat-value mono">{totalRows.toLocaleString()}</div>
          <div className="stat-label">Rows Backed Up</div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono">{(counts.leads ?? 0).toLocaleString()}</div>
          <div className="stat-label">Contacts</div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono">{rows.length}</div>
          <div className="stat-label">Tables</div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono">Nightly</div>
          <div className="stat-label">Automatic Schedule</div>
        </div>
      </div>

      {skippedKeys.length > 0 && (
        <p className="error-note">
          Couldn&apos;t read: {skippedKeys.join(", ")}. Fix this before relying on the backup — a
          partial copy is worse than none, because it looks fine until you need it.
        </p>
      )}

      <p className="hint-note">
        This is an export of your records, not a substitute for Supabase&apos;s own backups. It
        gives you last night&apos;s snapshot; it can&apos;t rewind to an arbitrary moment. Page-view
        tracking and portal sign-in tokens are deliberately left out — the first is noise, the
        second is short-lived credentials that shouldn&apos;t be copied around.
      </p>

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Table</th>
              <th className="right">Rows</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([table, count]) => (
              <tr key={table}>
                <td className="mono">{table}</td>
                <td className="right mono">{count.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
