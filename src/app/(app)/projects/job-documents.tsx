"use client";

import { useCallback, useEffect, useState } from "react";
import { getJobDocuments, fileDocumentUnderJob } from "@/lib/actions/estimate-files";
import { Modal } from "@/components/ui/modal";
import type { LeadPhoto } from "@/lib/data/types";

/**
 * ONE job's paperwork: permits, plans, the signed contract scan --
 * only what is filed under this contract. The customer's unfiled
 * documents are offered below for one-click filing, so a customer
 * with two jobs never shows job A's permit under job B, and a file
 * nobody filed yet is one click from its home rather than hidden.
 */
export function JobDocuments({
  leadId,
  estimateId,
  jobLabel,
  canFile,
  onClose,
}: {
  leadId: string;
  estimateId: string;
  jobLabel: string;
  canFile: boolean;
  onClose: () => void;
}) {
  const [filed, setFiled] = useState<LeadPhoto[] | null>(null);
  const [unfiled, setUnfiled] = useState<LeadPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    const res = await getJobDocuments(leadId, estimateId);
    if (res.error) setError(res.error);
    setFiled(res.filed ?? []);
    setUnfiled(res.unfiled ?? []);
  }, [leadId, estimateId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await getJobDocuments(leadId, estimateId);
      if (cancelled) return;
      if (res.error) setError(res.error);
      setFiled(res.filed ?? []);
      setUnfiled(res.unfiled ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [leadId, estimateId]);

  async function move(fileId: string, to: string | null) {
    setBusy(true);
    const res = await fileDocumentUnderJob(fileId, to);
    setBusy(false);
    if (res.error) return setError(res.error);
    await reload();
  }

  const row = (d: LeadPhoto, action: "file" | "unfile") => (
    <li key={d.id}>
      <a href={d.file_url} target="_blank" rel="noopener noreferrer">
        📄 {d.file_name}
      </a>{" "}
      <span className="est-tax-note">
        {new Date(d.created_at).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}
      </span>
      {canFile && (
        <button
          type="button"
          className="btn-ghost small"
          style={{ marginLeft: 8 }}
          disabled={busy}
          onClick={() => void move(d.id, action === "file" ? estimateId : null)}
        >
          {action === "file" ? "File under this job" : "Remove from job"}
        </button>
      )}
    </li>
  );

  return (
    <Modal title={`Permits & contracts — ${jobLabel}`} onClose={onClose}>
      {error && <p className="error-note">{error}</p>}
      {filed === null ? (
        <p className="empty-hint">Loading documents…</p>
      ) : (
        <>
          {filed.length === 0 ? (
            <p className="empty-hint">
              No documents filed under this job yet
              {unfiled.length
                ? " — file one from the customer's documents below."
                : " — upload them on the contact's Files tab, then file them here."}
            </p>
          ) : (
            <ul className="jp-docs" style={{ marginTop: 0 }}>
              {filed.map((d) => row(d, "unfile"))}
            </ul>
          )}
          {canFile && unfiled.length > 0 && (
            <details className="jp-unfiled" open={filed.length === 0}>
              <summary>
                Other documents on this customer, not filed to a job ({unfiled.length})
              </summary>
              <ul className="jp-docs">{unfiled.map((d) => row(d, "file"))}</ul>
            </details>
          )}
        </>
      )}
    </Modal>
  );
}
