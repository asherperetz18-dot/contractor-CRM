"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  purgeTrashEntry,
  restoreLeadFromTrash,
  type TrashEntry,
} from "@/lib/actions/lead-trash";

export function TrashView({ entries }: { entries: TrashEntry[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  // Delete forever arms on the first click and fires on the second --
  // a confirm dialog on top of a page that exists because of an
  // accidental click would still be one click from disaster.
  const [armedPurge, setArmedPurge] = useState("");

  async function restore(entry: TrashEntry) {
    setBusy(entry.id);
    setError("");
    setMessage("");
    const result = await restoreLeadFromTrash(entry.id);
    setBusy("");
    if (result?.error) {
      setError(result.error);
      return;
    }
    const partial = result?.issues?.length
      ? ` (${result.issues.length} item${result.issues.length === 1 ? "" : "s"} couldn't come back — the contact itself is fine)`
      : "";
    setMessage(`${entry.display_name || "Contact"} restored${partial}.`);
    startTransition(() => router.refresh());
  }

  async function purge(entry: TrashEntry) {
    if (armedPurge !== entry.id) {
      setArmedPurge(entry.id);
      return;
    }
    setBusy(entry.id);
    setError("");
    setMessage("");
    const result = await purgeTrashEntry(entry.id);
    setBusy("");
    setArmedPurge("");
    if (result?.error) {
      setError(result.error);
      return;
    }
    setMessage("Deleted forever.");
    startTransition(() => router.refresh());
  }

  return (
    <div>
      <div className="ur-breadcrumb">
        <Link href="/settings" className="ur-crumb-link">
          ⚙ Settings
        </Link>
        <span> › </span>
        <span>Trash</span>
      </div>

      {message && <p className="hint-note">✓ {message}</p>}
      {error && <p className="error-note">{error}</p>}

      {entries.length === 0 ? (
        <div className="empty-state">
          <p className="empty-label">The trash is empty</p>
          <p className="empty-hint">
            When someone deletes a contact it lands here for 30 days before it&apos;s gone for
            good.
          </p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Contact</th>
                <th>What comes back</th>
                <th>Deleted</th>
                <th>By</th>
                <th className="right"></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>{e.display_name || "(no name)"}</td>
                  <td>{e.summary}</td>
                  <td>
                    {new Date(e.deleted_at).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </td>
                  <td>{e.deleted_by_name || "—"}</td>
                  <td className="right">
                    <button
                      type="button"
                      className="btn-primary small"
                      onClick={() => restore(e)}
                      disabled={busy === e.id}
                    >
                      {busy === e.id ? "Working…" : "Restore"}
                    </button>{" "}
                    <button
                      type="button"
                      className="btn-ghost small"
                      onClick={() => purge(e)}
                      disabled={busy === e.id}
                    >
                      {armedPurge === e.id ? "Click again to confirm" : "Delete forever"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
