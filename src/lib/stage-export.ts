/**
 * Pure core of the per-stage contact export (Settings → Pipeline
 * Stages). The CSV is the backup a bulk stage delete leaves behind, so
 * the headers are the same human names the CSV import recognises — an
 * exported stage can be re-imported as-is if the delete turns out to
 * have been a mistake.
 */

export const STAGE_EXPORT_COLUMNS = [
  { key: "first_name", header: "First Name" },
  { key: "last_name", header: "Last Name" },
  { key: "company_name", header: "Company" },
  { key: "phone", header: "Phone" },
  { key: "phone2", header: "Phone 2" },
  { key: "phone3", header: "Phone 3" },
  { key: "email", header: "Email" },
  { key: "address", header: "Address" },
  { key: "zip", header: "Zip" },
  { key: "second_contact_first_name", header: "Second Contact First Name" },
  { key: "second_contact_last_name", header: "Second Contact Last Name" },
  { key: "second_contact_phone", header: "Second Contact Phone" },
  { key: "second_contact_email", header: "Second Contact Email" },
  { key: "source", header: "Source" },
  { key: "project_type", header: "Project Type" },
  { key: "stage", header: "Stage" },
  { key: "value", header: "Value" },
  { key: "date_received", header: "Date Received" },
  { key: "notes", header: "Notes" },
  { key: "created_at", header: "Created At" },
] as const;

export type StageExportLead = Record<
  (typeof STAGE_EXPORT_COLUMNS)[number]["key"],
  string | number | null | undefined
>;

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function csvLine(lead: StageExportLead): string {
  return STAGE_EXPORT_COLUMNS.map((c) => csvCell(lead[c.key])).join(",");
}

export function leadsToCsv(leads: StageExportLead[]): string {
  return [
    STAGE_EXPORT_COLUMNS.map((c) => c.header).join(","),
    ...leads.map(csvLine),
  ].join("\n");
}

/** e.g. "rows-incoming-contacts-2026-09-20.csv" — header- and filesystem-safe. */
export function stageExportFilename(stage: string, now: Date = new Date()): string {
  const slug =
    stage
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "stage";
  return `${slug}-contacts-${now.toISOString().slice(0, 10)}.csv`;
}
