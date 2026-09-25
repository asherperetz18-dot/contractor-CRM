/**
 * Who deleted which customer file, and when (migration 0182).
 *
 * A deleted photo leaves no row behind, so without this there is no
 * answer to "where did the demo photos go?". deleteLeadFile snapshots
 * the file as it stood into lead_file_deletions after the delete lands;
 * the job photo popup reads it back as a short history.
 */

/** The lead_files columns the snapshot is taken from. */
export type DeletedLeadFileRow = {
  id: string;
  lead_id: string;
  estimate_id: string | null;
  file_name: string;
  content_type: string | null;
  storage_provider?: string | null;
  uploaded_by: string | null;
  created_at: string;
};

/** One history entry, as the popup reads it. */
export type LeadFileDeletion = {
  id: string;
  estimate_id: string | null;
  file_name: string;
  content_type: string | null;
  deleted_by: string | null;
  deleted_at: string;
};

/** The history row for a file that was just deleted. */
export function deletionRecord(row: DeletedLeadFileRow, companyId: string, deletedBy: string) {
  return {
    company_id: companyId,
    lead_id: row.lead_id,
    estimate_id: row.estimate_id,
    file_id: row.id,
    file_name: row.file_name,
    content_type: row.content_type,
    storage_provider: row.storage_provider ?? null,
    uploaded_by: row.uploaded_by,
    uploaded_at: row.created_at,
    deleted_by: deletedBy,
  };
}

/**
 * The deleted photos a job's popup could have shown: filed under this
 * job, or unfiled on the customer. Another job's photos stay with that
 * job, the same line the popup itself draws.
 */
export function photoDeletionsForJob(list: LeadFileDeletion[], estimateId: string) {
  return list.filter(
    (d) =>
      (d.content_type ?? "").startsWith("image/") &&
      (d.estimate_id === estimateId || d.estimate_id === null)
  );
}

export function describeDeletion(
  d: LeadFileDeletion,
  nameOf: (id: string) => string,
  estimateId: string
): string {
  const who = d.deleted_by ? nameOf(d.deleted_by) : "a removed user";
  const where =
    d.estimate_id === estimateId ? "was filed under this job" : "was not filed to a job";
  return `${d.file_name} — deleted by ${who} · ${where}`;
}

/** The words on the delete confirm: a photo is one file, shown everywhere. */
export function deletePhotoConfirm(fileName: string, storageProvider?: string | null): string {
  const recover =
    storageProvider === "google_drive"
      ? " It stays in the Google Drive trash for 30 days if you need it back."
      : " This can't be undone.";
  return (
    `Delete "${fileName}"?\n\n` +
    "It is removed everywhere it shows — this job, the customer's Files, and any visit." +
    recover +
    '\n\nFiled under the wrong job? Use "Remove from job" instead.'
  );
}
