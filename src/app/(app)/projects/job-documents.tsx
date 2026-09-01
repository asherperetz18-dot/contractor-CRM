"use client";

import { useEffect, useState } from "react";
import { getLeadDocuments } from "@/lib/actions/estimate-files";
import { Modal } from "@/components/ui/modal";
import type { LeadPhoto } from "@/lib/data/types";

/**
 * The job's paperwork, off the project row: permits, plans, the signed
 * contract scan -- every non-media file on the lead, newest first.
 * Read-only on purpose; uploading stays with the contact's Files tab
 * and the Photos modal, so there is exactly one way files arrive.
 */
export function JobDocuments({
  leadId,
  jobLabel,
  onClose,
}: {
  leadId: string;
  jobLabel: string;
  onClose: () => void;
}) {
  const [docs, setDocs] = useState<LeadPhoto[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await getLeadDocuments(leadId);
      if (cancelled) return;
      if (res.error) setError(res.error);
      setDocs(res.documents ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  return (
    <Modal title={`Permits & contracts — ${jobLabel}`} onClose={onClose}>
      {error && <p className="error-note">{error}</p>}
      {docs === null ? (
        <p className="empty-hint">Loading documents…</p>
      ) : docs.length === 0 ? (
        <p className="empty-hint">
          No permits or contract files on this job yet — upload them from the contact&apos;s
          Files tab and they&apos;ll appear here.
        </p>
      ) : (
        <ul className="jp-docs" style={{ marginTop: 0 }}>
          {docs.map((d) => (
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
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
