"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { Modal } from "@/components/ui/modal";
import { Field } from "@/components/ui/field";
import type { PipelineStage, PipelineStageRow } from "@/lib/data/types";
import { bulkImportLeads } from "@/lib/actions/leads";

type Mapping = {
  firstName: number;
  lastName: number;
  fullName: number;
  phone: number;
  email: number;
  company: number;
  address: number;
  projectType: number;
  value: number;
};

const BLANK_MAPPING: Mapping = {
  firstName: -1,
  lastName: -1,
  fullName: -1,
  phone: -1,
  email: -1,
  company: -1,
  address: -1,
  projectType: -1,
  value: -1,
};

function guessColumn(headers: string[], candidates: string[]) {
  const norm = (s: string) => (s || "").toLowerCase().trim();
  const words = (s: string) => norm(s).split(/[^a-z0-9]+/).filter(Boolean);
  const lower = headers.map(norm);
  for (const cand of candidates) {
    const idx = lower.findIndex((h) => h === cand);
    if (idx !== -1) return idx;
  }
  for (const cand of candidates) {
    const idx = headers.findIndex((h) => words(h).includes(cand));
    if (idx !== -1) return idx;
  }
  for (const cand of candidates) {
    if (!cand.includes(" ")) continue;
    const idx = lower.findIndex((h) => h.includes(cand));
    if (idx !== -1) return idx;
  }
  return -1;
}

// Some exporters mis-declare a sheet's used range, which makes SheetJS stop
// reading early. Recompute the true range from the actual cells present.
function fullSheetRange(sheet: XLSX.WorkSheet) {
  let maxRow = 0;
  let maxCol = 0;
  let found = false;
  for (const addr in sheet) {
    if (addr[0] === "!") continue;
    const decoded = XLSX.utils.decode_cell(addr);
    found = true;
    if (decoded.r > maxRow) maxRow = decoded.r;
    if (decoded.c > maxCol) maxCol = decoded.c;
  }
  return found ? { s: { r: 0, c: 0 }, e: { r: maxRow, c: maxCol } } : undefined;
}

function cell(row: unknown[], idx: number) {
  return idx >= 0 && idx < row.length ? String(row[idx] ?? "").trim() : "";
}

export function CsvImportPanel({
  stages,
  onCancel,
}: {
  stages: PipelineStageRow[];
  onCancel: () => void;
}) {
  const router = useRouter();
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<unknown[][]>([]);
  const [mapping, setMapping] = useState<Mapping>(BLANK_MAPPING);
  const [targetStage, setTargetStage] = useState<PipelineStage>("Unsorted");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [importedCount, setImportedCount] = useState<number | null>(null);
  const [skippedCount, setSkippedCount] = useState<number | null>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setImportedCount(null);
    setSkippedCount(null);
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const trueRange = fullSheetRange(sheet);
        const json = XLSX.utils.sheet_to_json(sheet, {
          header: 1,
          defval: "",
          range: trueRange,
        }) as unknown[][];
        if (!json.length) {
          setError("That file looks empty.");
          return;
        }
        const head = (json[0] as unknown[]).map((h) => String(h ?? "").trim());
        const body = json
          .slice(1)
          .filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
        setHeaders(head);
        setRows(body);
        setMapping({
          firstName: guessColumn(head, ["first name", "firstname", "first"]),
          lastName: guessColumn(head, ["last name", "lastname", "last"]),
          fullName: guessColumn(head, ["name", "full name", "contact", "contact name"]),
          phone: guessColumn(head, ["phone", "phone number", "mobile", "cell"]),
          email: guessColumn(head, ["email", "email address"]),
          company: guessColumn(head, ["company", "business"]),
          address: guessColumn(head, ["address", "job address", "street"]),
          projectType: guessColumn(head, ["project", "project type", "scope"]),
          value: guessColumn(head, ["value", "amount", "est. value", "deal size"]),
        });
        if (wb.SheetNames.length > 1) {
          setError(
            `Note: this file has ${wb.SheetNames.length} sheets/tabs — only "${wb.SheetNames[0]}" was read. If some contacts are on another tab, export or upload that tab separately.`
          );
        }
      } catch {
        setError("Couldn't read that file — make sure it's a .csv or .xlsx export.");
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function setMap(field: keyof Mapping, idx: string) {
    setMapping((m) => ({ ...m, [field]: Number(idx) }));
  }

  function buildLeads() {
    return rows.map((row) => {
      let firstName = cell(row, mapping.firstName);
      let lastName = cell(row, mapping.lastName);
      if (!firstName && mapping.fullName >= 0) {
        const full = cell(row, mapping.fullName).split(" ");
        firstName = full[0] || "";
        lastName = full.slice(1).join(" ") || "";
      }
      return {
        company_name: cell(row, mapping.company),
        first_name: firstName,
        last_name: lastName,
        phone: cell(row, mapping.phone),
        email: cell(row, mapping.email),
        address: cell(row, mapping.address),
        project_type: cell(row, mapping.projectType),
        value: cell(row, mapping.value),
      };
    });
  }

  const usableLeads = rows.length
    ? buildLeads().filter((l) => l.first_name || l.last_name || l.phone || l.email)
    : [];

  async function runImport() {
    const hasNameSource = mapping.firstName >= 0 || mapping.fullName >= 0;
    if (!hasNameSource) {
      setError("Map at least a Name column before importing.");
      return;
    }
    const built = buildLeads();
    const newLeads = built.filter(
      (l) => l.first_name || l.last_name || l.phone || l.email
    );
    if (!newLeads.length) {
      setError("No rows had a usable name, phone, or email — check your column mapping above.");
      return;
    }
    setPending(true);
    setError("");
    const result = await bulkImportLeads(newLeads, targetStage);
    setPending(false);
    if ("error" in result && result.error) {
      setError(`${result.error} (${result.imported} imported before the error)`);
      return;
    }
    setImportedCount(result.imported ?? 0);
    setSkippedCount(built.length - newLeads.length);
    router.refresh();
  }

  const previewRows = rows.slice(0, 5);
  const mappingFields: [keyof Mapping, string][] = [
    ["firstName", "First Name"],
    ["lastName", "Last Name"],
    ["fullName", "Full Name (if not split)"],
    ["phone", "Phone"],
    ["email", "Email"],
    ["company", "Company"],
    ["address", "Address"],
    ["projectType", "Project Type"],
    ["value", "Est. Value"],
  ];

  return (
    <Modal title="Import Leads from CSV" onClose={onCancel} wide>
      <p className="hint-note" style={{ marginTop: 0 }}>
        Upload a .csv or Excel export — we&apos;ll map the columns and add
        everyone to the pipeline stage you choose below.
      </p>

      <input
        type="file"
        accept=".csv,.xlsx,.xls"
        onChange={handleFile}
        className="logo-file-input"
      />
      {fileName && (
        <p className="hint-note">
          Loaded: {fileName} · {rows.length} row{rows.length === 1 ? "" : "s"} found in file
        </p>
      )}
      {error && <p className="logo-error">{error}</p>}

      {headers.length > 0 && (
        <>
          <div className="csv-map-grid">
            {mappingFields.map(([field, label]) => (
              <Field key={field} label={label}>
                <select
                  value={mapping[field]}
                  onChange={(e) => setMap(field, e.target.value)}
                >
                  <option value={-1}>— don&apos;t import —</option>
                  {headers.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `Column ${i + 1}`}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
            <Field label="Add to Stage">
              <select
                value={targetStage}
                onChange={(e) => setTargetStage(e.target.value as PipelineStage)}
              >
                {stages.map((s) => (
                  <option key={s.id} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <p
            className={
              "csv-usable-note" +
              (usableLeads.length < rows.length ? " csv-usable-warn" : "")
            }
          >
            With the current mapping: <strong>{usableLeads.length}</strong> of{" "}
            {rows.length} rows will import
            {usableLeads.length < rows.length
              ? ` — ${rows.length - usableLeads.length} have no name, phone, or email in the mapped columns. Check the mapping above if that looks wrong.`
              : "."}
          </p>

          {previewRows.length > 0 && (
            <div className="csv-preview">
              <div className="csv-preview-label">
                Preview (first {previewRows.length} of {rows.length})
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Phone</th>
                    <th>Email</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((r, i) => {
                    const fn =
                      cell(r, mapping.firstName) ||
                      (mapping.fullName >= 0 ? cell(r, mapping.fullName) : "");
                    const ln = cell(r, mapping.lastName);
                    return (
                      <tr key={i}>
                        <td>{`${fn} ${ln}`.trim() || "—"}</td>
                        <td>{cell(r, mapping.phone) || "—"}</td>
                        <td>{cell(r, mapping.email) || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {importedCount !== null && (
        <p className="cp-saved">
          ✓ Imported {importedCount} contact{importedCount === 1 ? "" : "s"}.
          {skippedCount ? ` ${skippedCount} row${skippedCount === 1 ? "" : "s"} skipped (no name/phone/email).` : ""}
        </p>
      )}

      <div className="modal-actions">
        <div />
        <div>
          <button className="btn-ghost" onClick={onCancel}>
            {importedCount !== null ? "Close" : "Cancel"}
          </button>
          {importedCount === null && (
            <button
              className="btn-primary"
              disabled={!rows.length || pending}
              onClick={runImport}
            >
              {pending
                ? "Importing…"
                : `Import ${rows.length ? rows.length : ""} Contacts`}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
