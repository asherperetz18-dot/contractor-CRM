import React, { useState, useEffect, useCallback } from "react";
import * as XLSX from "xlsx";

/* ---------- design tokens ----------
  ink-900   #14202E  sidebar / headers
  blueprint #2D5F8A  primary structural
  safety    #C7691B  accent / field role
  success   #2F855A
  danger    #C0392B
  paper     #F5F3EE  app background
--------------------------------------- */

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');`;

const uid = () => Math.random().toString(36).slice(2, 9);
const todayISO = () => new Date().toISOString().slice(0, 10);
const money = (n) =>
  (Number(n) || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });

const LEAD_STAGES = ["New Leads", "Contacted", "Estimate Scheduled", "Estimate Sent", "Negotiating", "Won", "Lost"];
const JOB_STATUSES = ["Not Started", "In Progress", "On Hold", "Complete"];
const DOC_STATUSES = ["Draft", "Sent", "Approved", "Paid"];
const CONTRACT_STATUSES = ["Draft", "Sent", "Signed"];

const STAGE_COLOR = {
  "New Leads": "#7C8798",
  "Contacted": "#2D5F8A",
  "Estimate Scheduled": "#C7691B",
  "Estimate Sent": "#C7691B",
  "Negotiating": "#B7862B",
  "Won": "#2F855A",
  "Lost": "#C0392B",
  "Other": "#9A9384",
};

const JOB_COLOR = {
  "Not Started": "#7C8798",
  "In Progress": "#2D5F8A",
  "On Hold": "#C7691B",
  "Complete": "#2F855A",
};

// ---------- storage helpers ----------
async function loadKey(key, fallback) {
  try {
    const res = await window.storage.get(key, true);
    return res ? JSON.parse(res.value) : fallback;
  } catch (e) {
    return fallback;
  }
}
async function saveKey(key, value) {
  try {
    await window.storage.set(key, JSON.stringify(value), true);
  } catch (e) {
    console.error("storage save failed", key, e);
  }
}

// ---------- generic primitives ----------
function Badge({ color, children }) {
  return (
    <span
      className="badge-chip"
      style={{ background: color + "1c", color, borderColor: color + "55" }}
    >
      {children}
    </span>
  );
}

function Field({ label, children }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={"modal" + (wide ? " modal-wide" : "")} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function EmptyState({ label, hint }) {
  return (
    <div className="empty-state">
      <div className="empty-mark" aria-hidden="true">＋</div>
      <p className="empty-label">{label}</p>
      <p className="empty-hint">{hint}</p>
    </div>
  );
}

// ================= PIPELINE (Leads) =================
function daysSince(dateStr) {
  if (!dateStr) return 0;
  const d = new Date(dateStr);
  if (isNaN(d)) return 0;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function Pipeline({ leads, setLeads, jobs, setJobs, events, setEvents, role, openTrigger }) {
  const [editing, setEditing] = useState(null); // lead object or null
  const [showNew, setShowNew] = useState(false);
  const [statusFilter, setStatusFilter] = useState("Open"); // Open | Won | Lost
  const [sortBy, setSortBy] = useState("Days");
  const [draggedId, setDraggedId] = useState(null);
  const [dragOverStage, setDragOverStage] = useState(null);

  useEffect(() => { if (openTrigger) setShowNew(true); }, [openTrigger]);

  function upsertLead(lead) {
    setLeads((prev) => {
      const exists = prev.some((l) => l.id === lead.id);
      return exists ? prev.map((l) => (l.id === lead.id ? lead : l)) : [lead, ...prev];
    });
  }

  function removeLead(id) {
    setLeads((prev) => prev.filter((l) => l.id !== id));
    setEditing(null);
  }

  function moveLeadToStage(id, stage) {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, stage } : l)));
  }

  function handleDrop(stage) {
    if (draggedId && stage !== "Other") moveLeadToStage(draggedId, stage);
    setDraggedId(null);
    setDragOverStage(null);
  }

  function convertToJob(lead) {
    const job = {
      id: uid(),
      leadId: lead.id,
      name: `${lead.firstName} ${lead.lastName}`.trim() + " — Project",
      address: lead.address || "",
      status: "Not Started",
      startDate: "",
      endDate: "",
      assignedTo: "",
      notes: "",
      createdAt: todayISO(),
    };
    setJobs((prev) => [job, ...prev]);
    upsertLead({ ...lead, stage: "Won" });
    setEditing(null);
  }

  function bookAppointment(lead, details) {
    const contactName = lead.contactType === "Company" ? (lead.companyName || "") : `${lead.firstName || ""} ${lead.lastName || ""}`.trim();
    const event = {
      id: uid(),
      title: details.title || `${details.eventType} — ${contactName}`,
      date: details.date,
      time: details.time,
      eventType: details.eventType,
      assignedTo: details.assignedTo,
      relatedId: "",
      leadId: lead.id,
      notes: "",
    };
    setEvents((prev) => [...prev, event]);
    upsertLead({ ...lead, hasAppt: true, stage: lead.stage === "New Leads" || lead.stage === "Contacted" ? "Estimate Scheduled" : lead.stage });
    setEditing(null);
  }

  const statusFiltered = leads.filter((l) => {
    if (statusFilter === "Open") return !["Won", "Lost"].includes(l.stage);
    if (statusFilter === "Won") return l.stage === "Won";
    return l.stage === "Lost";
  });

  const openLeads = leads.filter((l) => !["Won", "Lost"].includes(l.stage));
  const pipelineValue = openLeads.reduce((s, l) => s + (Number(l.value) || 0), 0);
  const avgDealSize = openLeads.length ? pipelineValue / openLeads.length : 0;
  const wonThisPeriod = leads.filter((l) => l.stage === "Won").reduce((s, l) => s + (Number(l.value) || 0), 0);
  const staleCount = openLeads.filter((l) => daysSince(l.createdAt) > 14).length;
  const noApptCount = openLeads.filter((l) => !l.hasAppt).length;

  const sortedFiltered = [...statusFiltered].sort((a, b) => {
    if (sortBy === "Name") return `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`);
    if (sortBy === "Amount") return (Number(b.value) || 0) - (Number(a.value) || 0);
    return daysSince(b.createdAt) - daysSince(a.createdAt); // Days (most stale first)
  });

  const grouped = LEAD_STAGES.filter((s) => !["Won", "Lost"].includes(s)).map((stage) => ({
    stage,
    items: sortedFiltered.filter((l) => l.stage === stage),
  }));

  const knownStages = new Set(LEAD_STAGES);
  const unmatched = sortedFiltered.filter((l) => !knownStages.has(l.stage));
  if (statusFilter === "Open" && unmatched.length > 0) {
    grouped.push({ stage: "Other", items: unmatched });
  }

  const displayGroups = statusFilter === "Won"
    ? [{ stage: "Won", items: sortedFiltered }]
    : statusFilter === "Lost"
    ? [{ stage: "Lost", items: sortedFiltered }]
    : grouped;

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h2 className="module-title">Pipeline</h2>
          <p className="module-sub">{leads.length} opps · {statusFilter.toLowerCase()}</p>
        </div>
        <button className="btn-primary" onClick={() => setShowNew(true)}>+ New Lead</button>
      </div>

      <div className="stat-grid stat-grid-5">
        <div className="stat-card stat-static">
          <div className="stat-value mono">{money(pipelineValue).replace(".00", "")}</div>
          <div className="stat-label">Pipeline Value</div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono">{money(avgDealSize).replace(".00", "")}</div>
          <div className="stat-label">Avg Deal Size</div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono">{money(wonThisPeriod).replace(".00", "")}</div>
          <div className="stat-label">Won</div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono">{staleCount}</div>
          <div className="stat-label">Stale (&gt;14d)</div>
        </div>
        <div className="stat-card" onClick={() => setStatusFilter("Open")}>
          <div className="stat-value mono">{noApptCount}</div>
          <div className="stat-label">No Appt Yet</div>
        </div>
      </div>

      <div className="filter-bar">
        <div className="chip-row no-margin">
          {["Open", "Won", "Lost"].map((s) => (
            <button key={s} className={"chip" + (statusFilter === s ? " chip-active" : "")} onClick={() => setStatusFilter(s)}>{s}</button>
          ))}
        </div>
        <div className="filter-bar-right">
          <span className="filter-label">Sort by</span>
          {["Name", "Days", "Amount"].map((s) => (
            <button key={s} className={"chip" + (sortBy === s ? " chip-active" : "")} onClick={() => setSortBy(s)}>{s}</button>
          ))}
        </div>
      </div>

      {leads.length === 0 ? (
        <EmptyState label="No leads yet" hint="Add your first lead to start filling the pipeline." />
      ) : (
        <div className="pipeline-board">
          {displayGroups.map(({ stage, items }) => (
            <div
              className={"pipeline-col" + (dragOverStage === stage && stage !== "Other" ? " pipeline-col-dragover" : "")}
              key={stage}
              onDragOver={(e) => { if (stage !== "Other") { e.preventDefault(); setDragOverStage(stage); } }}
              onDragLeave={() => setDragOverStage((s) => (s === stage ? null : s))}
              onDrop={(e) => { e.preventDefault(); handleDrop(stage); }}
            >
              <div className="pipeline-col-head">
                <span className="tick" style={{ background: STAGE_COLOR[stage] }} />
                <span>{stage}</span>
                <span className="count-pill">{items.length}</span>
              </div>
              <div className="pipeline-col-body">
                {items.map((l) => {
                  const stale = daysSince(l.createdAt);
                  return (
                    <div
                      className={"lead-card" + (draggedId === l.id ? " lead-card-dragging" : "")}
                      key={l.id}
                      draggable
                      onDragStart={(e) => { setDraggedId(l.id); e.dataTransfer.effectAllowed = "move"; }}
                      onDragEnd={() => { setDraggedId(null); setDragOverStage(null); }}
                      onClick={() => setEditing(l)}
                    >
                      <div className="lead-card-name-row">
                        <span className="lead-card-name">{l.contactType === "Company" ? (l.companyName || "Unnamed Company") : (`${l.firstName || ""} ${l.lastName || ""}`.trim() || l.company || "Unnamed")}</span>
                        {l.source && <span className="source-tag">{l.source}</span>}
                      </div>
                      {l.phone && <div className="lead-card-line">☎ {l.phone}</div>}
                      {l.email && <div className="lead-card-line">✉ {l.email}</div>}
                      {l.address && <div className="lead-card-line">📍 {l.address}</div>}
                      {l.projectType && <div className="lead-card-project">{l.projectType}</div>}
                      <div className="lead-card-foot">
                        <span className="mono">{money(l.value)}</span>
                        {stale > 14 && !["Won", "Lost"].includes(l.stage) && (
                          <span className="stale-tag">● {stale} days — stale</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {showNew && (
        <LeadForm
          onCancel={() => setShowNew(false)}
          onSave={(l) => { upsertLead(l); setShowNew(false); }}
          onBulkImport={(newLeads) => { setLeads((prev) => [...newLeads, ...prev]); setShowNew(false); }}
        />
      )}
      {editing && (
        <LeadForm
          lead={editing}
          onCancel={() => setEditing(null)}
          onSave={(l) => { upsertLead(l); setEditing(null); }}
          onDelete={() => removeLead(editing.id)}
          onConvert={() => convertToJob(editing)}
          onBook={(details) => bookAppointment(editing, details)}
        />
      )}
    </div>
  );
}

// ---- CSV / Excel bulk import ----
const IMPORT_TARGET_STAGES = ["New Leads", "Contacted", "Estimate Scheduled"];

function guessColumn(headers, candidates) {
  const norm = (s) => (s || "").toLowerCase().trim();
  const words = (s) => norm(s).split(/[^a-z0-9]+/).filter(Boolean);
  const lower = headers.map(norm);
  // 1) exact header match
  for (const cand of candidates) {
    const idx = lower.findIndex((h) => h === cand);
    if (idx !== -1) return idx;
  }
  // 2) candidate matches a whole word in the header (avoids "first" matching "First Visit Date")
  for (const cand of candidates) {
    const idx = headers.findIndex((h) => words(h).includes(cand));
    if (idx !== -1) return idx;
  }
  // 3) header contains candidate as a substring (last resort, multi-word candidates only)
  for (const cand of candidates) {
    if (!cand.includes(" ")) continue;
    const idx = lower.findIndex((h) => h.includes(cand));
    if (idx !== -1) return idx;
  }
  return -1;
}

// Some exporters mis-declare a sheet's used range, which makes SheetJS stop
// reading early. Recompute the true range from the actual cells present.
function fullSheetRange(sheet) {
  let maxRow = 0, maxCol = 0, found = false;
  for (const addr in sheet) {
    if (addr[0] === "!") continue;
    const decoded = XLSX.utils.decode_cell(addr);
    found = true;
    if (decoded.r > maxRow) maxRow = decoded.r;
    if (decoded.c > maxCol) maxCol = decoded.c;
  }
  return found ? { s: { r: 0, c: 0 }, e: { r: maxRow, c: maxCol } } : null;
}

function CsvImportPanel({ companies, onCancel, onImport }) {
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [mapping, setMapping] = useState({ firstName: -1, lastName: -1, fullName: -1, phone: -1, email: -1, company: -1, address: -1, projectType: -1, value: -1 });
  const [targetStage, setTargetStage] = useState("New Leads");
  const [error, setError] = useState("");
  const [importedCount, setImportedCount] = useState(null);
  const [skippedCount, setSkippedCount] = useState(null);

  function handleFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setError("");
    setImportedCount(null);
    setSkippedCount(null);
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target.result);
        const wb = XLSX.read(data, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const trueRange = fullSheetRange(sheet);
        const json = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", range: trueRange || undefined });
        if (!json.length) { setError("That file looks empty."); return; }
        const head = json[0].map((h) => String(h || "").trim());
        const body = json.slice(1).filter((r) => r.some((cell) => String(cell || "").trim() !== ""));
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
          setError(`Note: this file has ${wb.SheetNames.length} sheets/tabs — only "${wb.SheetNames[0]}" was read. If some contacts are on another tab, export or upload that tab separately.`);
        }
      } catch (err) {
        setError("Couldn't read that file — make sure it's a .csv or .xlsx export.");
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function setMap(field, idx) {
    setMapping((m) => ({ ...m, [field]: Number(idx) }));
  }

  function cell(row, idx) {
    return idx >= 0 && idx < row.length ? String(row[idx] || "").trim() : "";
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
        id: uid(),
        contactType: "Individual",
        company: companies[0] || "",
        companyName: cell(row, mapping.company),
        firstName, lastName,
        phone: cell(row, mapping.phone),
        email: cell(row, mapping.email),
        address: cell(row, mapping.address),
        zip: "",
        source: "CSV Import",
        projectType: cell(row, mapping.projectType),
        stage: targetStage,
        value: cell(row, mapping.value),
        notes: "",
        createdAt: todayISO(),
        hasAppt: false,
        secondContact: null,
      };
    });
  }

  const usableCount = rows.length
    ? buildLeads().filter((l) => l.firstName || l.lastName || l.phone || l.email).length
    : 0;

  function runImport() {
    const hasNameSource = mapping.firstName >= 0 || mapping.fullName >= 0;
    if (!hasNameSource) { setError("Map at least a Name column before importing."); return; }
    const built = buildLeads();
    const newLeads = built.filter((l) => l.firstName || l.lastName || l.phone || l.email);

    if (!newLeads.length) { setError("No rows had a usable name, phone, or email — check your column mapping above."); return; }
    setImportedCount(newLeads.length);
    setSkippedCount(built.length - newLeads.length);
    onImport(newLeads);
  }

  const previewRows = rows.slice(0, 5);

  return (
    <div>
      <p className="hint-note" style={{ marginTop: 0 }}>Upload a .csv or Excel export — we'll map the columns and add everyone to the pipeline stage you choose below.</p>

      <input type="file" accept=".csv,.xlsx,.xls" onChange={handleFile} className="logo-file-input" />
      {fileName && <p className="hint-note">Loaded: {fileName} · {rows.length} row{rows.length === 1 ? "" : "s"} found in file</p>}
      {error && <p className="logo-error">{error}</p>}

      {headers.length > 0 && (
        <>
          <div className="csv-map-grid">
            {[
              ["firstName", "First Name"], ["lastName", "Last Name"], ["fullName", "Full Name (if not split)"],
              ["phone", "Phone"], ["email", "Email"], ["company", "Company"],
              ["address", "Address"], ["projectType", "Project Type"], ["value", "Est. Value"],
            ].map(([field, label]) => (
              <Field key={field} label={label}>
                <select value={mapping[field]} onChange={(e) => setMap(field, e.target.value)}>
                  <option value={-1}>— don't import —</option>
                  {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                </select>
              </Field>
            ))}
            <Field label="Add to Stage">
              <select value={targetStage} onChange={(e) => setTargetStage(e.target.value)}>
                {IMPORT_TARGET_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>

          <p className={"csv-usable-note" + (usableCount < rows.length ? " csv-usable-warn" : "")}>
            With the current mapping: <strong>{usableCount}</strong> of {rows.length} rows will import
            {usableCount < rows.length ? ` — ${rows.length - usableCount} have no name, phone, or email in the mapped columns. Check the mapping above if that looks wrong.` : "."}
          </p>

          {previewRows.length > 0 && (
            <div className="csv-preview">
              <div className="csv-preview-label">Preview (first {previewRows.length} of {rows.length})</div>
              <table className="data-table">
                <thead><tr><th>Name</th><th>Phone</th><th>Email</th></tr></thead>
                <tbody>
                  {previewRows.map((r, i) => {
                    const fn = cell(r, mapping.firstName) || (mapping.fullName >= 0 ? cell(r, mapping.fullName) : "");
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
          {skippedCount > 0 ? ` ${skippedCount} row${skippedCount === 1 ? "" : "s"} skipped (no name/phone/email).` : ""}
        </p>
      )}

      <div className="modal-actions">
        <div />
        <div>
          <button className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn-primary" disabled={!rows.length} onClick={runImport}>Import {rows.length ? rows.length : ""} Contacts</button>
        </div>
      </div>
    </div>
  );
}

function LeadForm({ lead, onSave, onCancel, onDelete, onConvert, onBulkImport, onBook }) {
  const [showBooking, setShowBooking] = useState(false);
  const [booking, setBooking] = useState({ date: todayISO(), time: "09:00", eventType: "Estimate", assignedTo: "" });
  const draftKey = lead ? `contact-draft-${lead.id}` : "contact-draft-new";
  const baseForm = lead || { id: uid(), contactType: "Individual", company: "", companyName: "", firstName: "", lastName: "", phone: "", email: "", address: "", zip: "", source: "", projectType: "", stage: "New Leads", value: "", notes: "", createdAt: todayISO(), hasAppt: false, secondContact: null };

  const [entryMode, setEntryMode] = useState("single"); // single | csv
  const [form, setForm] = useState(baseForm);
  const [companies, setCompanies] = useState([]);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [showDraftBanner, setShowDraftBanner] = useState(false);

  useEffect(() => {
    (async () => {
      const list = await loadKey("crm-companies", ["LA Home Contractor DBA LA Home Restoration"]);
      setCompanies(list);
      let draft = null;
      try {
        const res = await window.storage.get(draftKey, false);
        draft = res ? JSON.parse(res.value) : null;
      } catch (e) { draft = null; }
      if (draft) {
        setForm({ ...baseForm, ...draft });
        setShowDraftBanner(true);
      } else if (!form.company) {
        setForm((f) => ({ ...f, company: list[0] || "" }));
      }
      setDraftLoaded(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!draftLoaded) return;
    (async () => {
      try { await window.storage.set(draftKey, JSON.stringify(form), false); } catch (e) {}
    })();
  }, [form, draftLoaded, draftKey]);

  async function discardDraft() {
    try { await window.storage.delete(draftKey, false); } catch (e) {}
    setForm(baseForm);
    setShowDraftBanner(false);
  }

  async function clearDraftAndSave(finalForm) {
    try { await window.storage.delete(draftKey, false); } catch (e) {}
    onSave(finalForm);
  }

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const addSecondContact = () => setForm((f) => ({ ...f, secondContact: { firstName: "", lastName: "", phone: "" } }));
  const setSecond = (k, v) => setForm((f) => ({ ...f, secondContact: { ...f.secondContact, [k]: v } }));
  const removeSecondContact = () => setForm((f) => ({ ...f, secondContact: null }));
  const fullName = () => `${form.firstName} ${form.lastName}`.trim();

  return (
    <Modal title={lead ? "Edit Contact" : "New Contact"} onClose={onCancel} wide={entryMode === "csv"}>
      {!lead && onBulkImport && (
        <div className="segmented entry-mode-toggle">
          <button type="button" className={"segmented-btn" + (entryMode === "single" ? " active" : "")} onClick={() => setEntryMode("single")}>Single entry</button>
          <button type="button" className={"segmented-btn" + (entryMode === "csv" ? " active" : "")} onClick={() => setEntryMode("csv")}>CSV upload</button>
        </div>
      )}

      {entryMode === "csv" ? (
        <CsvImportPanel companies={companies} onCancel={onCancel} onImport={onBulkImport} />
      ) : (
      <>
      {showDraftBanner && (
        <div className="draft-banner">
          <span>Draft restored from a previous session</span>
          <button className="draft-discard" onClick={discardDraft}>🗑 Discard</button>
        </div>
      )}
      <div className="form-grid">
        <Field label="Company *">
          <select value={form.company} onChange={(e) => set("company", e.target.value)}>
            {companies.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Contact Type">
          <div className="segmented">
            <button type="button" className={"segmented-btn" + (form.contactType === "Individual" ? " active" : "")} onClick={() => set("contactType", "Individual")}>Individual</button>
            <button type="button" className={"segmented-btn" + (form.contactType === "Company" ? " active" : "")} onClick={() => set("contactType", "Company")}>Company</button>
          </div>
        </Field>
        {form.contactType === "Company" && (
          <Field label="Company Name *"><input value={form.companyName} onChange={(e) => set("companyName", e.target.value)} placeholder="Business name" /></Field>
        )}
        <Field label={form.contactType === "Company" ? "Contact Person First Name" : "First Name *"}>
          <input value={form.firstName} onChange={(e) => set("firstName", e.target.value)} />
        </Field>
        <Field label={form.contactType === "Company" ? "Contact Person Last Name" : "Last Name *"}>
          <input value={form.lastName} onChange={(e) => set("lastName", e.target.value)} />
        </Field>
        <Field label="Phone *"><input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="(555) 555-5555" /></Field>
        <Field label="Email"><input value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="client@email.com" type="email" /></Field>
      </div>

      {form.secondContact ? (
        <div className="second-contact-block">
          <div className="second-contact-head">
            <span>Second Contact</span>
            <button className="icon-btn" onClick={removeSecondContact} aria-label="Remove second contact">✕</button>
          </div>
          <div className="form-grid">
            <Field label="First Name"><input value={form.secondContact.firstName} onChange={(e) => setSecond("firstName", e.target.value)} /></Field>
            <Field label="Last Name"><input value={form.secondContact.lastName} onChange={(e) => setSecond("lastName", e.target.value)} /></Field>
            <Field label="Phone"><input value={form.secondContact.phone} onChange={(e) => setSecond("phone", e.target.value)} /></Field>
          </div>
        </div>
      ) : (
        <button className="btn-ghost small" onClick={addSecondContact}>+ Add second contact (e.g. spouse / co-owner)</button>
      )}

      <div className="form-grid" style={{ marginTop: 14 }}>
        <Field label="Address"><input value={form.address} onChange={(e) => set("address", e.target.value)} placeholder="Job site address" /></Field>
        <Field label="Zip"><input value={form.zip} onChange={(e) => set("zip", e.target.value)} /></Field>
        <Field label="Project Type"><input value={form.projectType} onChange={(e) => set("projectType", e.target.value)} placeholder="Kitchen, Roofing..." /></Field>
        <Field label="Source"><input value={form.source} onChange={(e) => set("source", e.target.value)} placeholder="Referral, website..." /></Field>
        <Field label="Est. Value"><input value={form.value} onChange={(e) => set("value", e.target.value)} placeholder="0" inputMode="decimal" /></Field>
        <Field label="Stage">
          <select value={form.stage} onChange={(e) => set("stage", e.target.value)}>
            {LEAD_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Has Appointment?">
          <select value={form.hasAppt ? "yes" : "no"} onChange={(e) => set("hasAppt", e.target.value === "yes")}>
            <option value="no">Not yet</option>
            <option value="yes">Scheduled</option>
          </select>
        </Field>
      </div>
      <Field label="Notes"><textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} /></Field>

      {onBook && (
        showBooking ? (
          <div className="second-contact-block">
            <div className="second-contact-head">
              <span>Book Appointment</span>
              <button className="icon-btn" onClick={() => setShowBooking(false)} aria-label="Cancel booking">✕</button>
            </div>
            <div className="form-grid">
              <Field label="Date"><input type="date" value={booking.date} onChange={(e) => setBooking((b) => ({ ...b, date: e.target.value }))} /></Field>
              <Field label="Time"><input type="time" value={booking.time} onChange={(e) => setBooking((b) => ({ ...b, time: e.target.value }))} /></Field>
              <Field label="Type">
                <select value={booking.eventType} onChange={(e) => setBooking((b) => ({ ...b, eventType: e.target.value }))}>
                  {["Estimate", "Job Visit", "Meeting", "Other"].map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Assigned To"><input value={booking.assignedTo} onChange={(e) => setBooking((b) => ({ ...b, assignedTo: e.target.value }))} /></Field>
            </div>
            <button className="btn-primary small" onClick={() => onBook(booking)}>Confirm &amp; Add to Calendar</button>
          </div>
        ) : (
          <button className="btn-ghost small" onClick={() => setShowBooking(true)} style={{ marginBottom: 14 }}>📅 Book Appointment</button>
        )
      )}

      <div className="modal-actions">
        <div className="modal-actions-left">
          {onDelete && <button className="btn-danger-ghost" onClick={onDelete}>Delete</button>}
          {onConvert && form.stage !== "Won" && (
            <button className="btn-ghost" onClick={onConvert}>Mark Won → Create Job</button>
          )}
        </div>
        <div>
          <button className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn-primary" onClick={() => {
            const valid = form.contactType === "Company"
              ? form.companyName.trim() && form.phone.trim()
              : form.firstName.trim() && form.lastName.trim() && form.phone.trim();
            valid && clearDraftAndSave(form);
          }}>Save</button>
        </div>
      </div>
      </>
      )}
    </Modal>
  );
}

// ================= PRODUCTION (Jobs) =================
function Production({ jobs, setJobs, openTrigger }) {
  const [editing, setEditing] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [filter, setFilter] = useState("All");

  useEffect(() => { if (openTrigger) setShowNew(true); }, [openTrigger]);

  const filtered = filter === "All" ? jobs : jobs.filter((j) => j.status === filter);

  function upsertJob(job) {
    setJobs((prev) => {
      const exists = prev.some((j) => j.id === job.id);
      return exists ? prev.map((j) => (j.id === job.id ? job : j)) : [job, ...prev];
    });
  }
  function removeJob(id) {
    setJobs((prev) => prev.filter((j) => j.id !== id));
    setEditing(null);
  }

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h2 className="module-title">Production</h2>
          <p className="module-sub">{jobs.length} projects</p>
        </div>
        <button className="btn-primary" onClick={() => setShowNew(true)}>+ New Job</button>
      </div>

      <div className="chip-row">
        {["All", ...JOB_STATUSES].map((s) => (
          <button key={s} className={"chip" + (filter === s ? " chip-active" : "")} onClick={() => setFilter(s)}>{s}</button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState label="No jobs here" hint="Jobs created from won leads, or add one directly." />
      ) : (
        <div className="job-grid">
          {filtered.map((j) => (
            <div className="job-card" key={j.id} onClick={() => setEditing(j)}>
              <div className="job-card-top">
                <span className="job-name">{j.name}</span>
                <Badge color={JOB_COLOR[j.status]}>{j.status}</Badge>
              </div>
              {j.address && <div className="job-address">{j.address}</div>}
              <div className="job-meta-row">
                {j.assignedTo && <span>👷 {j.assignedTo}</span>}
                {j.startDate && <span className="mono">{j.startDate}{j.endDate ? " → " + j.endDate : ""}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {showNew && (
        <JobForm onCancel={() => setShowNew(false)} onSave={(j) => { upsertJob(j); setShowNew(false); }} />
      )}
      {editing && (
        <JobForm job={editing} onCancel={() => setEditing(null)} onSave={(j) => { upsertJob(j); setEditing(null); }} onDelete={() => removeJob(editing.id)} />
      )}
    </div>
  );
}

function JobForm({ job, onSave, onCancel, onDelete }) {
  const [form, setForm] = useState(
    job || { id: uid(), name: "", address: "", status: "Not Started", startDate: "", endDate: "", assignedTo: "", notes: "", createdAt: todayISO() }
  );
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <Modal title={job ? "Edit Job" : "New Job"} onClose={onCancel}>
      <div className="form-grid">
        <Field label="Project Name"><input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Kitchen remodel" /></Field>
        <Field label="Address"><input value={form.address} onChange={(e) => set("address", e.target.value)} placeholder="Job site address" /></Field>
        <Field label="Status">
          <select value={form.status} onChange={(e) => set("status", e.target.value)}>
            {JOB_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Assigned To"><input value={form.assignedTo} onChange={(e) => set("assignedTo", e.target.value)} placeholder="Crew lead / team" /></Field>
        <Field label="Start Date"><input type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} /></Field>
        <Field label="End Date"><input type="date" value={form.endDate} onChange={(e) => set("endDate", e.target.value)} /></Field>
      </div>
      <Field label="Notes"><textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} /></Field>
      <div className="modal-actions">
        <div className="modal-actions-left">
          {onDelete && <button className="btn-danger-ghost" onClick={onDelete}>Delete</button>}
        </div>
        <div>
          <button className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn-primary" onClick={() => form.name.trim() && onSave(form)}>Save</button>
        </div>
      </div>
    </Modal>
  );
}

// ================= ACCOUNTING (Estimates / Invoices) =================
function Documents({ docs, setDocs, jobs, leads, openTrigger }) {
  const [editing, setEditing] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [tab, setTab] = useState("Estimate");

  useEffect(() => { if (openTrigger) setShowNew(true); }, [openTrigger]);

  const filtered = docs.filter((d) => d.type === tab);
  const totalOutstanding = docs
    .filter((d) => d.type === "Invoice" && d.status !== "Paid")
    .reduce((s, d) => s + Number(d.total || 0), 0);

  function upsertDoc(doc) {
    setDocs((prev) => {
      const exists = prev.some((d) => d.id === doc.id);
      return exists ? prev.map((d) => (d.id === doc.id ? doc : d)) : [doc, ...prev];
    });
  }
  function removeDoc(id) {
    setDocs((prev) => prev.filter((d) => d.id !== id));
    setEditing(null);
  }

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h2 className="module-title">Estimates &amp; Invoices</h2>
          <p className="module-sub">{money(totalOutstanding)} outstanding on unpaid invoices</p>
        </div>
        <button className="btn-primary" onClick={() => setShowNew(true)}>+ New {tab}</button>
      </div>

      <div className="chip-row">
        {["Estimate", "Invoice"].map((t) => (
          <button key={t} className={"chip" + (tab === t ? " chip-active" : "")} onClick={() => setTab(t)}>{t}s</button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState label={`No ${tab.toLowerCase()}s yet`} hint="Create one to send to a client." />
      ) : (
        <table className="data-table">
          <thead>
            <tr><th>Client</th><th>Job</th><th>Date</th><th>Status</th><th className="right">Total</th></tr>
          </thead>
          <tbody>
            {filtered.map((d) => (
              <tr key={d.id} onClick={() => setEditing(d)}>
                <td>{d.clientName}</td>
                <td>{jobs.find((j) => j.id === d.jobId)?.name || "—"}</td>
                <td className="mono">{d.date}</td>
                <td><Badge color={d.status === "Paid" ? "#2F855A" : d.status === "Approved" ? "#2D5F8A" : d.status === "Sent" ? "#C7691B" : "#7C8798"}>{d.status}</Badge></td>
                <td className="right mono">{money(d.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showNew && (
        <DocForm type={tab} jobs={jobs} leads={leads} onCancel={() => setShowNew(false)} onSave={(d) => { upsertDoc(d); setShowNew(false); }} />
      )}
      {editing && (
        <DocForm doc={editing} type={editing.type} jobs={jobs} leads={leads} onCancel={() => setEditing(null)} onSave={(d) => { upsertDoc(d); setEditing(null); }} onDelete={() => removeDoc(editing.id)} />
      )}
    </div>
  );
}

function DocForm({ doc, type, jobs, leads, onSave, onCancel, onDelete }) {
  const [form, setForm] = useState(
    doc || { id: uid(), type, contactId: "", clientName: "", clientPhone: "", clientEmail: "", clientAddress: "", jobId: "", date: todayISO(), status: "Draft", items: [{ id: uid(), desc: "", qty: 1, price: "" }], notes: "" }
  );
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setItem = (id, k, v) => setForm((f) => ({ ...f, items: f.items.map((it) => (it.id === id ? { ...it, [k]: v } : it)) }));
  const addItem = () => setForm((f) => ({ ...f, items: [...f.items, { id: uid(), desc: "", qty: 1, price: "" }] }));
  const removeItem = (id) => setForm((f) => ({ ...f, items: f.items.filter((it) => it.id !== id) }));
  const total = form.items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);

  function pullFromContact(leadId) {
    const l = leads.find((x) => x.id === leadId);
    if (!l) { set("contactId", ""); return; }
    const name = l.contactType === "Company" ? (l.companyName || "") : `${l.firstName || ""} ${l.lastName || ""}`.trim();
    setForm((f) => ({
      ...f,
      contactId: leadId,
      clientName: name,
      clientPhone: l.phone || "",
      clientEmail: l.email || "",
      clientAddress: l.address || "",
    }));
  }

  return (
    <Modal title={doc ? `Edit ${type}` : `New ${type}`} onClose={onCancel} wide>
      <Field label="Pull from Contact">
        <select value={form.contactId || ""} onChange={(e) => pullFromContact(e.target.value)}>
          <option value="">— select a contact to auto-fill —</option>
          {leads.map((l) => (
            <option key={l.id} value={l.id}>
              {l.contactType === "Company" ? (l.companyName || "Unnamed Company") : (`${l.firstName || ""} ${l.lastName || ""}`.trim() || "Unnamed")}
              {l.phone ? ` · ${l.phone}` : ""}
            </option>
          ))}
        </select>
      </Field>
      <div className="form-grid">
        <Field label="Client Name"><input value={form.clientName} onChange={(e) => set("clientName", e.target.value)} /></Field>
        <Field label="Client Phone"><input value={form.clientPhone} onChange={(e) => set("clientPhone", e.target.value)} /></Field>
        <Field label="Client Email"><input value={form.clientEmail} onChange={(e) => set("clientEmail", e.target.value)} type="email" /></Field>
        <Field label="Client Address"><input value={form.clientAddress} onChange={(e) => set("clientAddress", e.target.value)} /></Field>
        <Field label="Job">
          <select value={form.jobId} onChange={(e) => set("jobId", e.target.value)}>
            <option value="">— none —</option>
            {jobs.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
          </select>
        </Field>
        <Field label="Date"><input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} /></Field>
        <Field label="Status">
          <select value={form.status} onChange={(e) => set("status", e.target.value)}>
            {DOC_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
      </div>

      <div className="line-items">
        <div className="line-items-head">
          <span>Description</span>
        </div>
        {form.items.map((it, idx) => (
          <div className="line-item-card" key={it.id}>
            <div className="line-item-desc-row">
              <input value={it.desc} onChange={(e) => setItem(it.id, "desc", e.target.value)} placeholder="Materials, labor..." />
              <button className="icon-btn" onClick={() => removeItem(it.id)} aria-label="Remove line">✕</button>
            </div>
            <div className="line-item-nums-row">
              <div className="line-num-field">
                <span className="line-num-label">Qty</span>
                <input value={it.qty} onChange={(e) => setItem(it.id, "qty", e.target.value)} inputMode="decimal" placeholder="1" />
              </div>
              <div className="line-num-field">
                <span className="line-num-label">Price</span>
                <input value={it.price} onChange={(e) => setItem(it.id, "price", e.target.value)} inputMode="decimal" placeholder="0.00" />
              </div>
              <div className="line-num-field">
                <span className="line-num-label">Subtotal</span>
                <div className="mono line-subtotal">{money((Number(it.qty) || 0) * (Number(it.price) || 0))}</div>
              </div>
            </div>
          </div>
        ))}
        <button className="btn-ghost small" onClick={addItem}>+ Add line</button>
      </div>

      <div className="doc-total">Total <span className="mono">{money(total)}</span></div>

      <div className="modal-actions">
        <div className="modal-actions-left">
          {onDelete && <button className="btn-danger-ghost" onClick={onDelete}>Delete</button>}
        </div>
        <div>
          <button className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn-primary" onClick={() => form.clientName.trim() && onSave({ ...form, total })}>Save</button>
        </div>
      </div>
    </Modal>
  );
}

// ================= CALENDAR =================
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const WEEKDAY_LABELS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function ymd(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function CalendarView({ events, setEvents, jobs, leads, openTrigger }) {
  const today = new Date();
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [selectedDate, setSelectedDate] = useState(null);
  const [editing, setEditing] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [newDate, setNewDate] = useState(todayISO());

  useEffect(() => { if (openTrigger) { setNewDate(todayISO()); setShowNew(true); } }, [openTrigger]);

  function upsertEvent(ev) {
    setEvents((prev) => {
      const exists = prev.some((e) => e.id === ev.id);
      return exists ? prev.map((e) => (e.id === ev.id ? ev : e)) : [...prev, ev];
    });
  }
  function removeEvent(id) {
    setEvents((prev) => prev.filter((e) => e.id !== id));
    setEditing(null);
  }

  const { year, month } = cursor;
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const eventsByDate = {};
  events.forEach((ev) => {
    (eventsByDate[ev.date] = eventsByDate[ev.date] || []).push(ev);
  });

  const cells = [];
  for (let i = 0; i < firstDow; i++) {
    const d = daysInPrevMonth - firstDow + 1 + i;
    cells.push({ inMonth: false, day: d, dateStr: null });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ inMonth: true, day: d, dateStr: ymd(year, month, d) });
  }
  while (cells.length % 7 !== 0) {
    const d = cells.length - (firstDow + daysInMonth) + 1;
    cells.push({ inMonth: false, day: d, dateStr: null });
  }

  function prevMonth() {
    setCursor((c) => (c.month === 0 ? { year: c.year - 1, month: 11 } : { year: c.year, month: c.month - 1 }));
  }
  function nextMonth() {
    setCursor((c) => (c.month === 11 ? { year: c.year + 1, month: 0 } : { year: c.year, month: c.month + 1 }));
  }
  function goToday() {
    setCursor({ year: today.getFullYear(), month: today.getMonth() });
    setSelectedDate(todayISO());
  }

  function openNewOnDate(dateStr) {
    setNewDate(dateStr);
    setShowNew(true);
  }

  const selectedEvents = selectedDate ? (eventsByDate[selectedDate] || []).sort((a, b) => a.time.localeCompare(b.time)) : [];
  const todayStr = todayISO();

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h2 className="module-title">Calendar</h2>
          <p className="module-sub">{events.length} total appointments</p>
        </div>
        <button className="btn-primary" onClick={() => openNewOnDate(selectedDate || todayISO())}>+ New Appointment</button>
      </div>

      <div className="cal-toolbar">
        <div className="cal-nav">
          <button className="icon-btn cal-nav-btn" onClick={prevMonth} aria-label="Previous month">‹</button>
          <span className="cal-month-label">{MONTH_NAMES[month]} {year}</span>
          <button className="icon-btn cal-nav-btn" onClick={nextMonth} aria-label="Next month">›</button>
        </div>
        <button className="btn-ghost small" onClick={goToday}>Today</button>
      </div>

      <div className="cal-grid">
        {WEEKDAY_LABELS.map((w) => <div key={w} className="cal-weekday">{w}</div>)}
        {cells.map((c, i) => {
          const dayEvents = c.dateStr ? (eventsByDate[c.dateStr] || []) : [];
          const isToday = c.dateStr === todayStr;
          const isSelected = c.dateStr && c.dateStr === selectedDate;
          return (
            <div
              key={i}
              className={"cal-cell" + (c.inMonth ? "" : " cal-cell-out") + (isToday ? " cal-cell-today" : "") + (isSelected ? " cal-cell-selected" : "")}
              onClick={() => c.dateStr && setSelectedDate(c.dateStr)}
              onDoubleClick={() => c.dateStr && openNewOnDate(c.dateStr)}
            >
              <span className="cal-cell-day">{c.day}</span>
              <div className="cal-cell-events">
                {dayEvents.slice(0, 3).map((ev) => (
                  <div key={ev.id} className="cal-event-chip" onClick={(e) => { e.stopPropagation(); setEditing(ev); }}>
                    <span className="mono cal-event-time">{ev.time}</span> {ev.title}
                  </div>
                ))}
                {dayEvents.length > 3 && <div className="cal-event-more">+{dayEvents.length - 3} more</div>}
              </div>
            </div>
          );
        })}
      </div>

      {selectedDate && (
        <div className="cal-day-panel">
          <div className="cal-day-panel-head">
            <span>{selectedDate}</span>
            <button className="btn-ghost small" onClick={() => openNewOnDate(selectedDate)}>+ Add</button>
          </div>
          {selectedEvents.length === 0 ? (
            <p className="hint-note" style={{ marginTop: 0 }}>Nothing scheduled this day.</p>
          ) : (
            <div className="schedule-list">
              {selectedEvents.map((ev) => (
                <div className="schedule-row" key={ev.id} onClick={() => setEditing(ev)}>
                  <div className="schedule-date">
                    <span className="mono schedule-time">{ev.time}</span>
                  </div>
                  <div className="schedule-body">
                    <div className="schedule-title">{ev.title}</div>
                    <div className="schedule-meta">
                      <Badge color="#2D5F8A">{ev.eventType}</Badge>
                      {ev.assignedTo && <span>👷 {ev.assignedTo}</span>}
                      {jobs.find((j) => j.id === ev.relatedId) && <span>{jobs.find((j) => j.id === ev.relatedId).name}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showNew && (
        <EventForm
          jobs={jobs}
          initialDate={newDate}
          onCancel={() => setShowNew(false)}
          onSave={(e) => { upsertEvent(e); setShowNew(false); setSelectedDate(e.date); }}
        />
      )}
      {editing && (
        <EventForm event={editing} jobs={jobs} onCancel={() => setEditing(null)} onSave={(e) => { upsertEvent(e); setEditing(null); }} onDelete={() => removeEvent(editing.id)} />
      )}
    </div>
  );
}

// ================= SCHEDULE =================
function Schedule({ events, setEvents, jobs, leads, setLeads, openTrigger }) {
  const [editing, setEditing] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const sorted = [...events].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

  useEffect(() => { if (openTrigger) setShowNew(true); }, [openTrigger]);

  function upsertEvent(ev) {
    setEvents((prev) => {
      const exists = prev.some((e) => e.id === ev.id);
      return exists ? prev.map((e) => (e.id === ev.id ? ev : e)) : [...prev, ev];
    });
  }
  function removeEvent(id) {
    setEvents((prev) => prev.filter((e) => e.id !== id));
    setEditing(null);
  }

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h2 className="module-title">Schedule</h2>
          <p className="module-sub">{events.length} upcoming appointments</p>
        </div>
        <button className="btn-primary" onClick={() => setShowNew(true)}>+ New Appointment</button>
      </div>

      {sorted.length === 0 ? (
        <EmptyState label="Nothing scheduled" hint="Add estimates, site visits, or crew appointments." />
      ) : (
        <div className="schedule-list">
          {sorted.map((ev) => (
            <div className="schedule-row" key={ev.id} onClick={() => setEditing(ev)}>
              <div className="schedule-date">
                <span className="mono schedule-date-num">{ev.date}</span>
                <span className="mono schedule-time">{ev.time}</span>
              </div>
              <div className="schedule-body">
                <div className="schedule-title">{ev.title}</div>
                <div className="schedule-meta">
                  <Badge color="#2D5F8A">{ev.eventType}</Badge>
                  {ev.assignedTo && <span>👷 {ev.assignedTo}</span>}
                  {jobs.find((j) => j.id === ev.relatedId) && <span>{jobs.find((j) => j.id === ev.relatedId).name}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showNew && (
        <AppointmentWizard
          leads={leads}
          setLeads={setLeads}
          jobs={jobs}
          onCancel={() => setShowNew(false)}
          onFinish={(ev) => { if (ev) upsertEvent(ev); setShowNew(false); }}
        />
      )}
      {editing && (
        <EventForm event={editing} jobs={jobs} onCancel={() => setEditing(null)} onSave={(e) => { upsertEvent(e); setEditing(null); }} onDelete={() => removeEvent(editing.id)} />
      )}
    </div>
  );
}

// ---- New Appointment wizard: Contact -> Lead -> Appointment ----
function AppointmentWizard({ leads, setLeads, jobs, onCancel, onFinish }) {
  const draftKey = "appointment-draft-new";
  const blank = {
    company: "",
    contactQuery: "",
    matchedLeadId: "",
    newContact: { firstName: "", lastName: "", phone: "", email: "" },
    leadStage: "New Leads",
    projectType: "",
    value: "",
    address: "",
    apptTitle: "",
    apptType: "Estimate",
    apptDate: todayISO(),
    apptTime: "09:00",
    assignedTo: "",
    skipAppointment: false,
  };

  const [step, setStep] = useState(1);
  const [form, setForm] = useState(blank);
  const [companies, setCompanies] = useState([]);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [showDraftBanner, setShowDraftBanner] = useState(false);

  useEffect(() => {
    (async () => {
      const list = await loadKey("crm-companies", ["LA Home Contractor DBA LA Home Restoration"]);
      setCompanies(list);
      let draft = null;
      try {
        const res = await window.storage.get(draftKey, false);
        draft = res ? JSON.parse(res.value) : null;
      } catch (e) { draft = null; }
      if (draft) {
        setForm({ ...blank, ...draft });
        setShowDraftBanner(true);
      } else {
        setForm((f) => ({ ...f, company: list[0] || "" }));
      }
      setDraftLoaded(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!draftLoaded) return;
    (async () => {
      try { await window.storage.set(draftKey, JSON.stringify(form), false); } catch (e) {}
    })();
  }, [form, draftLoaded]);

  async function discardDraft() {
    try { await window.storage.delete(draftKey, false); } catch (e) {}
    setForm(blank);
    setShowDraftBanner(false);
    setStep(1);
  }

  async function clearDraft() {
    try { await window.storage.delete(draftKey, false); } catch (e) {}
  }

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setNew = (k, v) => setForm((f) => ({ ...f, newContact: { ...f.newContact, [k]: v } }));

  const matches = form.contactQuery.trim()
    ? leads.filter((l) => {
        const full = `${l.firstName || ""} ${l.lastName || ""}`.toLowerCase();
        return full.includes(form.contactQuery.toLowerCase()) || (l.companyName || "").toLowerCase().includes(form.contactQuery.toLowerCase());
      })
    : [];

  const selectedLead = leads.find((l) => l.id === form.matchedLeadId);
  const isNewContact = !!form.contactQuery.trim() && !form.matchedLeadId;

  function pickLead(l) {
    set("matchedLeadId", l.id);
    set("contactQuery", `${l.firstName || ""} ${l.lastName || ""}`.trim() || l.companyName || "");
  }

  function useAsNewContact() {
    set("matchedLeadId", "");
    setNew("firstName", form.contactQuery.split(" ")[0] || "");
    setNew("lastName", form.contactQuery.split(" ").slice(1).join(" ") || "");
    setStep(2);
  }

  function goStep2() {
    if (form.matchedLeadId) { setStep(3); return; }
    setStep(2);
  }

  function goStep3FromLead() {
    setStep(3);
  }

  function finishWithoutAppointment() {
    finalize(false);
  }

  function scheduleAppointment() {
    finalize(true);
  }

  async function finalize(createAppt) {
    let leadId = form.matchedLeadId;

    if (!leadId) {
      const newLead = {
        id: uid(),
        contactType: "Individual",
        company: form.company,
        companyName: "",
        firstName: form.newContact.firstName,
        lastName: form.newContact.lastName,
        phone: form.newContact.phone,
        email: form.newContact.email,
        address: form.address,
        zip: "",
        source: "",
        projectType: form.projectType,
        stage: form.leadStage,
        value: form.value,
        notes: "",
        createdAt: todayISO(),
        hasAppt: createAppt,
        secondContact: null,
      };
      setLeads((prev) => [newLead, ...prev]);
      leadId = newLead.id;
    } else if (createAppt) {
      setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, hasAppt: true } : l)));
    }

    await clearDraft();

    if (!createAppt) {
      onFinish(null);
      return;
    }

    const contactName = selectedLead
      ? (`${selectedLead.firstName || ""} ${selectedLead.lastName || ""}`.trim() || selectedLead.companyName)
      : `${form.newContact.firstName} ${form.newContact.lastName}`.trim();

    const event = {
      id: uid(),
      title: form.apptTitle || `${form.apptType} — ${contactName}`,
      date: form.apptDate,
      time: form.apptTime,
      eventType: form.apptType,
      assignedTo: form.assignedTo,
      relatedId: "",
      leadId,
      notes: "",
    };
    onFinish(event);
  }

  return (
    <Modal title="New Appointment" onClose={onCancel} wide>
      <p className="wizard-sub">Schedule an appointment — pick a contact, confirm the lead, set the time.</p>

      {showDraftBanner && (
        <div className="draft-banner">
          <span>Draft restored from a previous session</span>
          <button className="draft-discard" onClick={discardDraft}>🗑 Discard</button>
        </div>
      )}

      <Field label="Company *">
        <select value={form.company} onChange={(e) => set("company", e.target.value)}>
          {companies.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </Field>

      {/* Step 1: Contact */}
      <div className={"wizard-step" + (step === 1 ? " wizard-step-active" : "")}>
        <div className="wizard-step-head">
          <span className={"step-num" + (step > 1 ? " step-done" : "")}>{step > 1 ? "✓" : "1"}</span>
          <span className="step-label">Contact</span>
          <span className="step-hint">Name, phone, email</span>
        </div>
        {step === 1 && (
          <div className="wizard-step-body">
            <Field label="Contact *">
              <input
                value={form.contactQuery}
                onChange={(e) => { set("contactQuery", e.target.value); set("matchedLeadId", ""); }}
                placeholder="Type a name — we'll create a new contact automatically if it's new"
              />
            </Field>
            {matches.length > 0 && !form.matchedLeadId && (
              <div className="contact-match-list">
                {matches.slice(0, 5).map((l) => (
                  <div key={l.id} className="contact-match-row" onClick={() => pickLead(l)}>
                    {(`${l.firstName || ""} ${l.lastName || ""}`.trim() || l.companyName)} {l.phone && <span className="mono">· {l.phone}</span>}
                  </div>
                ))}
              </div>
            )}
            <div className="wizard-actions">
              <button
                className="btn-primary"
                disabled={!form.contactQuery.trim()}
                onClick={() => (form.matchedLeadId ? setStep(3) : useAsNewContact())}
              >
                Save &amp; continue →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Step 2: Lead (only for new contacts) */}
      {(step === 2 || (step > 2 && isNewContact)) && (
        <div className={"wizard-step" + (step === 2 ? " wizard-step-active" : "")}>
          <div className="wizard-step-head">
            <span className={"step-num" + (step > 2 ? " step-done" : "")}>{step > 2 ? "✓" : "2"}</span>
            <span className="step-label">Lead</span>
            <span className="step-hint">Confirm the deal details</span>
          </div>
          {step === 2 && (
            <div className="wizard-step-body">
              <div className="form-grid">
                <Field label="First Name"><input value={form.newContact.firstName} onChange={(e) => setNew("firstName", e.target.value)} /></Field>
                <Field label="Last Name"><input value={form.newContact.lastName} onChange={(e) => setNew("lastName", e.target.value)} /></Field>
                <Field label="Phone *"><input value={form.newContact.phone} onChange={(e) => setNew("phone", e.target.value)} /></Field>
                <Field label="Email"><input value={form.newContact.email} onChange={(e) => setNew("email", e.target.value)} /></Field>
                <Field label="Project Type"><input value={form.projectType} onChange={(e) => set("projectType", e.target.value)} placeholder="Kitchen, Roofing..." /></Field>
                <Field label="Est. Value"><input value={form.value} onChange={(e) => set("value", e.target.value)} inputMode="decimal" /></Field>
                <Field label="Stage">
                  <select value={form.leadStage} onChange={(e) => set("leadStage", e.target.value)}>
                    {LEAD_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
                <Field label="Address"><input value={form.address} onChange={(e) => set("address", e.target.value)} /></Field>
              </div>
              <div className="wizard-actions">
                <button className="btn-ghost" onClick={() => setStep(1)}>Back</button>
                <button className="btn-primary" disabled={!form.newContact.phone.trim()} onClick={goStep3FromLead}>Save &amp; continue →</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step 3: Appointment (optional) */}
      <div className={"wizard-step" + (step === 3 ? " wizard-step-active" : "")}>
        <div className="wizard-step-head">
          <span className="step-num">{isNewContact ? 3 : 2}</span>
          <span className="step-label">Appointment <span className="step-optional">· optional</span></span>
          <span className="step-hint">Skip or schedule</span>
        </div>
        {step === 3 && (
          <div className="wizard-step-body">
            <div className="form-grid">
              <Field label="Title"><input value={form.apptTitle} onChange={(e) => set("apptTitle", e.target.value)} placeholder="Estimate walkthrough..." /></Field>
              <Field label="Type">
                <select value={form.apptType} onChange={(e) => set("apptType", e.target.value)}>
                  {["Estimate", "Job Visit", "Meeting", "Other"].map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Date"><input type="date" value={form.apptDate} onChange={(e) => set("apptDate", e.target.value)} /></Field>
              <Field label="Time"><input type="time" value={form.apptTime} onChange={(e) => set("apptTime", e.target.value)} /></Field>
              <Field label="Assigned To"><input value={form.assignedTo} onChange={(e) => set("assignedTo", e.target.value)} /></Field>
            </div>
            <div className="wizard-actions">
              <button className="btn-ghost" onClick={() => setStep(isNewContact ? 2 : 1)}>Back</button>
              <button className="btn-ghost" onClick={finishWithoutAppointment}>Skip</button>
              <button className="btn-primary" onClick={scheduleAppointment}>Schedule appointment</button>
            </div>
          </div>
        )}
      </div>

      <div className="modal-actions wizard-footer">
        <div className="modal-actions-left">
          <button className="btn-ghost" onClick={onCancel}>Cancel</button>
        </div>
        <div className="wizard-footer-right">
          <button className="btn-danger-ghost small" onClick={discardDraft}>🗑 Discard Draft</button>
          <span className="step-indicator mono">Step {step} of {isNewContact ? 3 : 2}</span>
        </div>
      </div>
    </Modal>
  );
}

function EventForm({ event, jobs, initialDate, onSave, onCancel, onDelete }) {
  const [form, setForm] = useState(
    event || { id: uid(), title: "", date: initialDate || todayISO(), time: "09:00", eventType: "Estimate", assignedTo: "", relatedId: "", notes: "" }
  );
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <Modal title={event ? "Edit Appointment" : "New Appointment"} onClose={onCancel}>
      <div className="form-grid">
        <Field label="Title"><input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Site visit, estimate walkthrough..." /></Field>
        <Field label="Type">
          <select value={form.eventType} onChange={(e) => set("eventType", e.target.value)}>
            {["Estimate", "Job Visit", "Meeting", "Other"].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Date"><input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} /></Field>
        <Field label="Time"><input type="time" value={form.time} onChange={(e) => set("time", e.target.value)} /></Field>
        <Field label="Assigned To"><input value={form.assignedTo} onChange={(e) => set("assignedTo", e.target.value)} /></Field>
        <Field label="Related Job">
          <select value={form.relatedId} onChange={(e) => set("relatedId", e.target.value)}>
            <option value="">— none —</option>
            {jobs.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
          </select>
        </Field>
      </div>
      <div className="modal-actions">
        <div className="modal-actions-left">
          {onDelete && <button className="btn-danger-ghost" onClick={onDelete}>Delete</button>}
        </div>
        <div>
          <button className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn-primary" onClick={() => form.title.trim() && onSave(form)}>Save</button>
        </div>
      </div>
    </Modal>
  );
}

// ================= CONTRACTS =================
function Contracts({ contracts, setContracts, jobs, openTrigger }) {
  const [editing, setEditing] = useState(null);
  const [showNew, setShowNew] = useState(false);

  useEffect(() => { if (openTrigger) setShowNew(true); }, [openTrigger]);

  function upsertContract(c) {
    setContracts((prev) => {
      const exists = prev.some((x) => x.id === c.id);
      return exists ? prev.map((x) => (x.id === c.id ? c : x)) : [c, ...prev];
    });
  }
  function removeContract(id) {
    setContracts((prev) => prev.filter((c) => c.id !== id));
    setEditing(null);
  }
  function signContract(c) {
    upsertContract({ ...c, status: "Signed", signedDate: todayISO() });
    setEditing(null);
  }

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h2 className="module-title">Contracts</h2>
          <p className="module-sub">{contracts.filter((c) => c.status === "Signed").length} signed of {contracts.length}</p>
        </div>
        <button className="btn-primary" onClick={() => setShowNew(true)}>+ New Contract</button>
      </div>

      {contracts.length === 0 ? (
        <EmptyState label="No contracts yet" hint="Draft a contract and track it through signature." />
      ) : (
        <div className="job-grid">
          {contracts.map((c) => (
            <div className="job-card" key={c.id} onClick={() => setEditing(c)}>
              <div className="job-card-top">
                <span className="job-name">{c.title}</span>
                <Badge color={c.status === "Signed" ? "#2F855A" : c.status === "Sent" ? "#C7691B" : "#7C8798"}>{c.status}</Badge>
              </div>
              <div className="job-address">{c.clientName}</div>
              <div className="job-meta-row">
                {jobs.find((j) => j.id === c.jobId) && <span>{jobs.find((j) => j.id === c.jobId).name}</span>}
                {c.signedDate && <span className="mono">Signed {c.signedDate}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {showNew && (
        <ContractForm jobs={jobs} onCancel={() => setShowNew(false)} onSave={(c) => { upsertContract(c); setShowNew(false); }} />
      )}
      {editing && (
        <ContractForm
          contract={editing}
          jobs={jobs}
          onCancel={() => setEditing(null)}
          onSave={(c) => { upsertContract(c); setEditing(null); }}
          onDelete={() => removeContract(editing.id)}
          onSign={editing.status !== "Signed" ? () => signContract(editing) : null}
        />
      )}
    </div>
  );
}

function ContractForm({ contract, jobs, onSave, onCancel, onDelete, onSign }) {
  const [form, setForm] = useState(
    contract || { id: uid(), title: "", clientName: "", jobId: "", status: "Draft", signedDate: "", notes: "" }
  );
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <Modal title={contract ? "Edit Contract" : "New Contract"} onClose={onCancel}>
      <div className="form-grid">
        <Field label="Title"><input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Remodel agreement" /></Field>
        <Field label="Client Name"><input value={form.clientName} onChange={(e) => set("clientName", e.target.value)} /></Field>
        <Field label="Job">
          <select value={form.jobId} onChange={(e) => set("jobId", e.target.value)}>
            <option value="">— none —</option>
            {jobs.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select value={form.status} onChange={(e) => set("status", e.target.value)}>
            {CONTRACT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Notes"><textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} /></Field>
      <p className="hint-note">E-signature capture isn't wired up in this prototype — "Mark as Signed" simulates it.</p>
      <div className="modal-actions">
        <div className="modal-actions-left">
          {onDelete && <button className="btn-danger-ghost" onClick={onDelete}>Delete</button>}
          {onSign && <button className="btn-ghost" onClick={onSign}>Mark as Signed</button>}
        </div>
        <div>
          <button className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn-primary" onClick={() => form.title.trim() && onSave(form)}>Save</button>
        </div>
      </div>
    </Modal>
  );
}

// ================= DASHBOARD =================
function Dashboard({ leads, jobs, docs, events, contracts, setTabId }) {
  const openLeads = leads.filter((l) => !["Won", "Lost"].includes(l.stage)).length;
  const activeJobs = jobs.filter((j) => j.status === "In Progress").length;
  const outstanding = docs.filter((d) => d.type === "Invoice" && d.status !== "Paid").reduce((s, d) => s + Number(d.total || 0), 0);
  const upcoming = [...events].filter((e) => e.date >= todayISO()).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).slice(0, 5);

  const stats = [
    { label: "Open Leads", value: openLeads, tab: "pipeline" },
    { label: "Active Jobs", value: activeJobs, tab: "production" },
    { label: "Outstanding", value: money(outstanding), tab: "documents" },
    { label: "Unsigned Contracts", value: contracts.filter((c) => c.status !== "Signed").length, tab: "contracts" },
  ];

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h2 className="module-title">Dashboard</h2>
          <p className="module-sub">Job site overview</p>
        </div>
      </div>
      <div className="stat-grid">
        {stats.map((s) => (
          <div className="stat-card" key={s.label} onClick={() => setTabId(s.tab)}>
            <div className="stat-value mono">{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>
      <div className="dash-lower">
        <div className="dash-panel">
          <h3>Upcoming Schedule</h3>
          {upcoming.length === 0 ? <p className="empty-hint">Nothing on the books yet.</p> : (
            <ul className="dash-list">
              {upcoming.map((ev) => (
                <li key={ev.id}><span className="mono">{ev.date} {ev.time}</span> — {ev.title}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="dash-panel">
          <h3>Pipeline Snapshot</h3>
          <ul className="dash-list">
            {LEAD_STAGES.map((s) => {
              const n = leads.filter((l) => l.stage === s).length;
              return n > 0 ? (
                <li key={s}><span className="tick" style={{ background: STAGE_COLOR[s] }} /> {s} <span className="count-pill">{n}</span></li>
              ) : null;
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

// ================= ADMIN SETTINGS =================
const SETTINGS_CATEGORIES = [
  "Company Identity", "People & Access", "Sales & Pipeline", "Calendar & Appointments",
  "Phone & Dialer", "Projects & Operations", "Finance & Accounting", "Documents & Compliance",
  "Email & Messaging", "Notifications & Automations", "Integrations & AI", "Data Management",
  "System & Monitoring",
];

const SETTINGS_SECTIONS = [
  {
    category: "Company Identity",
    hint: "How your company appears across the app, portal, and documents",
    cards: [
      { title: "Company Profile", desc: "Company name, address, phone, email, website, and license details", icon: "🏢", key: "company-profile" },
      { title: "Logo", desc: "Upload your company logo and configure how it appears in emails and documents", icon: "🖼", key: "logo" },
      { title: "Appearance & Theme", desc: "Theme colors, dark/light mode, and visual style", icon: "🎨" },
      { title: "Social Media Links", desc: "LinkedIn, Facebook, Instagram, and other social profiles", icon: "🔗" },
      { title: "Insurance Documents", desc: "Upload liability, workers comp, and other insurance certificates", icon: "🛡" },
      { title: "License Certificates", desc: "Upload contractor licenses and state certifications", icon: "📜" },
    ],
  },
  {
    category: "People & Access",
    hint: "Team members, roles, permissions, and per-role defaults",
    cards: [
      { title: "Users & Roles", desc: "Invite team members, assign roles, and manage permissions", icon: "👥", key: "users-roles" },
      { title: "Role Visibility", desc: "Choose which pages each role can open. Hidden pages are removed from the sidebar and blocked at the URL.", icon: "👁" },
      { title: "Role Analytics Defaults", desc: "Default KPI visibility per role and dashboard layout", icon: "📊" },
    ],
  },
  {
    category: "Sales & Pipeline",
    hint: "Pipelines, lead sources, estimates, commissions, and marketing",
    cards: [
      { title: "Pipeline Stages", desc: "Manage stages within each pipeline (Appointment Scheduled, Won, Lost, etc.)", icon: "📍", key: "pipeline-stages" },
      { title: "Pipeline Custom Fields", desc: "Configure custom field schema for pipelines", icon: "🧩" },
      { title: "Stage Badges", desc: "Map pipeline stages to badge colors and labels shown on cards", icon: "🏷" },
      { title: "Estimate Defaults", desc: "Default terms and conditions, markup, deposit, expiration, and plan size limits", icon: "📄" },
      { title: "Estimate Templates", desc: "Pre-built estimates (bathroom, kitchen, ADU, pool, etc.) used to seed new estimates", icon: "🧾" },
      { title: "Commission & Lead Cost Defaults", desc: "Default lead cost and commission split percentages applied to new projects", icon: "%" },
      { title: "Lead Sources", desc: "Create and manage lead source categories (Zillow, Referral, etc.)", icon: "📥" },
      { title: "Marketing Messages", desc: "Reusable marketing texts & emails your team can send from any lead", icon: "✉" },
      { title: "Geofencing", desc: "Geofence radius, alerts, and check-in behavior", icon: "📡" },
    ],
  },
  {
    category: "Calendar & Appointments",
    hint: "Calendars, appointment notifications, and Google Calendar sync",
    cards: [
      { title: "Calendars", desc: "Configure the 5 system calendars (Sales Rep, Office, Architect, Sign-Off, 2nd @ Property) and add custom ones. Set colors per calendar.", icon: "📅" },
      { title: "Appointment Notifications", desc: "Appointment notification templates — the WhatsApp appointment notices, the Send SMS quick-text templates (Confirm, Reschedule, On my way, Running...", icon: "🔔" },
      { title: "Google Calendar", desc: "OAuth connection and sync settings for Google Calendar", icon: "📆" },
    ],
  },
  {
    category: "Phone & Dialer",
    hint: "Click-to-call, the power dialer, call scripts, and call outcomes",
    cards: [
      { title: "In-App Dialer (Twilio Voice)", desc: "Native click-to-call dialer: connection status, caller ID, and call recording toggle", icon: "📞" },
      { title: "Parallel (Predictive) Dialer", desc: "Dial 3–5 contacts at once, connect only to answered calls, with FCC-compliance guardrails (abandon message, rate governor, ring timeout)", icon: "📶" },
      { title: "Call Scripts", desc: "Phone-call scripts shown to admins in the Power Dialer when a call connects", icon: "📝" },
      { title: "Call Dispositions", desc: "Customize the call-outcome buttons in the dialer and what each one does (stats, pipeline moves, scheduler)", icon: "☎" },
    ],
  },
  {
    category: "Projects & Operations",
    hint: "Project types & statuses, schedules, checklists, and dashboards",
    cards: [
      { title: "Welcome Dashboard Widgets", desc: "Choose which widgets appear by default on the Welcome Dashboard", icon: "🧱" },
      { title: "Project Types", desc: "Manage project category list (Kitchen, Bath, Roof, etc.)", icon: "🏗" },
      { title: "Project Statuses", desc: "Manage the production statuses a project can move through", icon: "📶" },
      { title: "Checklist Templates", desc: "Template CRUD for project checklists", icon: "☑" },
      { title: "Schedule Templates", desc: "Templates for project schedules and Gantt charts", icon: "📋" },
      { title: "Schedule Categories", desc: "Category list for schedule items (Phase, Crew, Material, Inspection)", icon: "🗂" },
      { title: "Material Categories", desc: "Category list for PM Dashboard → Materials (appliances, tile, flooring, fixtures)", icon: "🧱" },
      { title: "Dashboard KPI Visibility", desc: "Control which KPI cards show on the main dashboard", icon: "📊" },
    ],
  },
  {
    category: "Finance & Accounting",
    hint: "Banks, payables & receivables, customer payments, QuickBooks",
    cards: [
      { title: "Finance Settings", desc: "Finance toggles including overpayment controls and Finance Manager behavior", icon: "💲" },
      { title: "Bank Accounts", desc: "Bank account CRUD, payment methods, deposit routing", icon: "🏦" },
      { title: "Payment Routing Instructions", desc: "Bank details shown at the bottom of every invoice", icon: "🧾" },
      { title: "Payables & Receivables", desc: "Payment focus day and on-demand missing progress payment phase creation", icon: "💲" },
      { title: "QuickBooks Integration", desc: "Connect QuickBooks, map fields, configure sync, matching rules", icon: "🔗" },
      { title: "Portal Payments", desc: "Connect Stripe so customers can pay invoices on the portal by card or ACH", icon: "💳" },
    ],
  },
  {
    category: "Documents & Compliance",
    hint: "Compliance templates, document folders, required paperwork, and legal letters",
    cards: [
      { title: "Compliance Templates", desc: "Compliance checklist templates, required fields, conditional logic", icon: "📝" },
      { title: "Document Folders", desc: "Folders and subtypes that project documents get filed under (Docs, Photos, Agreements, etc.) + per-audience visibility", icon: "🗂" },
      { title: "Paperwork Types", desc: "Documents tracked in PM Dashboard → Pending Paperwork", icon: "📄" },
      { title: "Document Requirements", desc: "Required document types for contracts and agreements", icon: "📃" },
      { title: "Vendor Contract Template", desc: "Edit the default subcontractor agreement sent for e-signature when you award a bid", icon: "✍" },
      { title: "Rescission Policy", desc: "Cooling-off period days and notice of cancellation template", icon: "⏱" },
      { title: "Sign-off Letter", desc: "Customer-satisfaction acknowledgement letter sent at project close-out", icon: "✅" },
    ],
  },
  {
    category: "Email & Messaging",
    hint: "Email domain, sender & templates, chat, SMS/WhatsApp, short links",
    cards: [
      { title: "Email Domain", desc: "Verify your sending domain with SPF, DKIM, and DMARC records", icon: "📧" },
      { title: "Email Sender Settings", desc: "From email, from name, and notification emails for proposals", icon: "📨" },
      { title: "Resend API Key", desc: "Optional: use your own Resend API key instead of the platform key", icon: "🔑" },
      { title: "Email Templates", desc: "Manage email templates for proposals, notifications, bulk outreach", icon: "📄" },
      { title: "Chat & Messaging", desc: "Chat provider configuration, webhooks, SMS, WhatsApp", icon: "💬" },
      { title: "Short Links", desc: "Create and manage short URLs with domain routing and analytics", icon: "🔗" },
    ],
  },
  {
    category: "Notifications & Automations",
    hint: "Automatic messages, alert recipients, and follow-up rules",
    cards: [
      { title: "Automations Center", desc: "Everything the system does automatically — and its switches", icon: "⚙" },
      { title: "Permit Digest Recipients", desc: "Choose which roles receive the daily permit digest email", icon: "🔔" },
      { title: "Dispatch Follow-up Alerts", desc: "WhatsApp alerts when follow-up items age past 3 / 7 / 14 days; recipients click a personalized link to complete, dismiss, reschedule, or reassign", icon: "🔔" },
    ],
  },
  {
    category: "Integrations & AI",
    hint: "Third-party connections, lead imports, webhooks, and AI",
    cards: [
      { title: "GoHighLevel Connection", desc: "GHL API connection, location selection, sync toggle", icon: "🔗" },
      { title: "GHL Field Mappings", desc: "Map GHL contact and lead fields to app fields", icon: "🗺" },
      { title: "OpenAI API Key", desc: "API key used to power AI features (estimates, analysis, assistant)", icon: "🔑" },
      { title: "AI Estimator", desc: "Prompt and model settings for the AI scope and estimate generator", icon: "🤖" },
      { title: "AI Analysis", desc: "Positive and negative signal prompts used by the AI analyzer", icon: "🧠" },
      { title: "Cloud Storage", desc: "Connect Dropbox or Google Drive to automatically sync project files and free up Supabase storage", icon: "☁" },
      { title: "Facebook Lead Ads", desc: "Auto-import leads from Facebook Lead Ads into Contacts & Leads", icon: "📘" },
      { title: "Google Local Services Ads", desc: "Auto-import Google Guarantee leads from Google Local Services Ads into Contacts & Leads", icon: "🔍" },
      { title: "Incoming Data (Webhooks)", desc: "Custom inbound URLs so your website, Zapier, or any system can push leads into iBuildPro", icon: "📥" },
      { title: "Outgoing Webhooks", desc: "Push lead status updates back to your CRM, lead source, or accounting system", icon: "📤" },
    ],
  },
  {
    category: "Data Management",
    hint: "Import data from other systems, clean up, and bulk-edit",
    cards: [
      { title: "Data Import", desc: "Upload CSV exports from another system — auto-detected for known sources, visual mapping for everything else", icon: "📊" },
      { title: "Junk Contacts Cleanup", desc: "Rules and batch actions to clean up junk or duplicate contacts", icon: "🧹" },
      { title: "Bulk Delete", desc: "Bulk delete contacts, leads, appointments, and users", icon: "🗑" },
    ],
  },
  {
    category: "System & Monitoring",
    hint: "Billing, usage, logs, audit trail, and platform tools",
    cards: [
      { title: "Billing & Usage", desc: "Subscription plan, features, billing history, and AI token usage", icon: "🧾" },
      { title: "Audit Log", desc: "View table change history, archive, and AI-generate summaries", icon: "🕐" },
    ],
  },
];

function SettingsCard({ card, onOpen }) {
  return (
    <div className="settings-card" onClick={() => onOpen(card)}>
      <span className="settings-card-icon">{card.icon}</span>
      <div>
        <div className="settings-card-title">{card.title}</div>
        <div className="settings-card-desc">{card.desc}</div>
      </div>
    </div>
  );
}

function UsersRolesPage({ users, setUsers, companies, newUser, setNewUser, onBack }) {
  const [search, setSearch] = useState("");
  const [companyFilter, setCompanyFilter] = useState("All Companies");
  const [statusTab, setStatusTab] = useState("Active");
  const [showCreate, setShowCreate] = useState(false);

  const q = search.trim().toLowerCase();
  const filtered = users.filter((u) => {
    if (statusTab !== "All" && u.status !== statusTab) return false;
    if (companyFilter !== "All Companies" && u.company !== companyFilter) return false;
    if (q && !(`${u.name} ${u.email}`.toLowerCase().includes(q))) return false;
    return true;
  });

  function createUser() {
    if (!newUser.name.trim() || !newUser.email.trim()) return;
    const roles = newUser.roles.split(",").map((r) => r.trim()).filter(Boolean);
    setUsers((prev) => [...prev, {
      id: uid(), name: newUser.name, email: newUser.email, phone: newUser.phone,
      company: newUser.company || companies[0] || "", roles: roles.length ? roles : ["Office"], status: "Active",
    }]);
    setNewUser({ name: "", email: "", phone: "", company: companies[0] || "", roles: "" });
    setShowCreate(false);
  }

  function toggleStatus(id) {
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, status: u.status === "Active" ? "Archived" : "Active" } : u)));
  }

  return (
    <div>
      <div className="ur-breadcrumb">
        <span className="ur-crumb-link" onClick={onBack}>⚙ Settings</span>
        <span> › </span>
        <span className="ur-crumb-link" onClick={onBack}>People &amp; Access</span>
        <span> › </span>
        <span>Users &amp; Roles</span>
      </div>

      <div className="module-toolbar">
        <div>
          <h2 className="module-title">Users &amp; Roles</h2>
          <p className="module-sub">Invite team members, assign roles, and manage permissions</p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>+ Create New User</button>
      </div>

      <div className="ur-guide-banner">
        <span className="ur-guide-icon">📘</span>
        <div className="ur-guide-body">
          <div className="ur-guide-title">
            Role &amp; Access Guide <span className="ur-guide-badge">See what each role can do</span>
          </div>
          <div className="ur-guide-desc">See exactly what each role can do across the system — sidebar sections, quick actions, and financial edits. Read this before assigning roles to a new user.</div>
        </div>
      </div>

      <div className="ur-filter-bar">
        <input className="ur-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search users" />
        <select className="ur-company-filter" value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)}>
          <option>All Companies</option>
          {companies.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <div className="chip-row no-margin">
          {["Active", "Archived", "All"].map((s) => (
            <button key={s} className={"chip" + (statusTab === s ? " chip-active" : "")} onClick={() => setStatusTab(s)}>{s}</button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState label="No users match" hint="Try a different search or filter, or create a new user." />
      ) : (
        <table className="data-table ur-table">
          <thead>
            <tr><th>Name</th><th>Email</th><th>Phone</th><th>Company</th><th>Roles</th><th className="right">Status</th></tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr key={u.id}>
                <td>
                  <div className="ur-name-cell">
                    <span className="ur-avatar">{(u.name || "?")[0].toUpperCase()}</span>
                    <div>
                      <div className="ur-name">{u.name}</div>
                      <Badge color={u.status === "Active" ? "#2F855A" : "#7C8798"}>{u.status}</Badge>
                    </div>
                  </div>
                </td>
                <td>{u.email}</td>
                <td>{u.phone || <span className="ur-add-phone">+ Add phone</span>}</td>
                <td>{u.company}</td>
                <td>
                  <div className="ur-role-badges">
                    {(u.roles || []).map((r) => <Badge key={r} color="#2D5F8A">{r}</Badge>)}
                  </div>
                </td>
                <td className="right">
                  <button className="ur-toggle-btn" onClick={() => toggleStatus(u.id)}>
                    <span className={"toggle-track" + (u.status === "Active" ? " toggle-on" : "")}>
                      <span className="toggle-thumb" />
                    </span>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showCreate && (
        <Modal title="Create New User" onClose={() => setShowCreate(false)}>
          <div className="form-grid">
            <Field label="Name"><input value={newUser.name} onChange={(e) => setNewUser((f) => ({ ...f, name: e.target.value }))} /></Field>
            <Field label="Email"><input value={newUser.email} onChange={(e) => setNewUser((f) => ({ ...f, email: e.target.value }))} type="email" /></Field>
            <Field label="Phone"><input value={newUser.phone} onChange={(e) => setNewUser((f) => ({ ...f, phone: e.target.value }))} /></Field>
            <Field label="Company">
              <select value={newUser.company} onChange={(e) => setNewUser((f) => ({ ...f, company: e.target.value }))}>
                {companies.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Roles"><input value={newUser.roles} onChange={(e) => setNewUser((f) => ({ ...f, roles: e.target.value }))} placeholder="Sales, Admin, Corp Admin..." /></Field>
          </div>
          <div className="modal-actions">
            <div />
            <div>
              <button className="btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn-primary" onClick={createUser}>Create User</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function CompanyProfilePage({ companyProfile, setCompanyProfile, setCompanies, onBack }) {
  const [form, setForm] = useState({ timezone: "Pacific", ...companyProfile });
  const [saved, setSaved] = useState(false);
  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setSaved(false); };

  function save() {
    setCompanyProfile(form);
    if (form.name && form.name.trim()) {
      setCompanies((prev) => {
        const next = [...prev];
        next[0] = form.name.trim();
        return next;
      });
    }
    setSaved(true);
  }

  const US_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];

  const TIMEZONES = [
    { value: "Pacific", label: "Pacific Time (PT)" },
    { value: "Mountain", label: "Mountain Time (MT)" },
    { value: "Central", label: "Central Time (CT)" },
    { value: "Eastern", label: "Eastern Time (ET)" },
    { value: "Alaska", label: "Alaska Time (AKT)" },
    { value: "Hawaii", label: "Hawaii Time (HT)" },
  ];

  const STATE_TZ = {
    CA: "Pacific", OR: "Pacific", WA: "Pacific", NV: "Pacific",
    AZ: "Mountain", CO: "Mountain", UT: "Mountain", NM: "Mountain", MT: "Mountain", WY: "Mountain", ID: "Mountain",
    TX: "Central", IL: "Central", MO: "Central", MN: "Central", WI: "Central", LA: "Central", OK: "Central", KS: "Central", NE: "Central", IA: "Central", AR: "Central", MS: "Central", AL: "Central", TN: "Central", SD: "Central", ND: "Central",
    NY: "Eastern", FL: "Eastern", GA: "Eastern", NC: "Eastern", SC: "Eastern", VA: "Eastern", PA: "Eastern", OH: "Eastern", MI: "Eastern", NJ: "Eastern", MA: "Eastern", MD: "Eastern", CT: "Eastern", ME: "Eastern", NH: "Eastern", VT: "Eastern", RI: "Eastern", DE: "Eastern", WV: "Eastern", KY: "Eastern", IN: "Eastern",
    AK: "Alaska", HI: "Hawaii",
  };

  function detectTimezone() {
    const guess = STATE_TZ[form.licenseState] || guessStateFromAddress(form.address);
    if (guess) set("timezone", guess);
  }

  function guessStateFromAddress(address) {
    if (!address) return null;
    const match = address.toUpperCase().match(/\b([A-Z]{2})\b(?!.*\b[A-Z]{2}\b)/);
    return match ? STATE_TZ[match[1]] : null;
  }

  return (
    <div>
      <div className="ur-breadcrumb">
        <span className="ur-crumb-link" onClick={onBack}>⚙ Settings</span>
        <span> › </span>
        <span className="ur-crumb-link" onClick={onBack}>Company Identity</span>
        <span> › </span>
        <span>Company Profile</span>
      </div>

      <div className="module-toolbar">
        <div>
          <h2 className="module-title">Company Profile</h2>
          <p className="module-sub">Company name, address, phone, email, website, and license details</p>
        </div>
      </div>

      <div className="cp-card">
        <div className="cp-card-head">🏢 Company Profile</div>
        <p className="cp-card-sub">Company name, address, phone, email, website, license details, and timezone</p>

        <Field label="Company Address"><input value={form.address} onChange={(e) => set("address", e.target.value)} placeholder="Street, city, state, zip" /></Field>
        <Field label="Company Email">
          <input value={form.email} onChange={(e) => set("email", e.target.value)} type="email" placeholder="info@yourcompany.com" />
        </Field>
        <p className="cp-hint">Company email address displayed on invoices and documents</p>
        <Field label="Company Name"><input value={form.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label="Company Phone"><input value={form.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
        <Field label="Company Website"><input value={form.website} onChange={(e) => set("website", e.target.value)} placeholder="yourcompany.com" /></Field>
        <Field label="License Holder Name"><input value={form.licenseHolderName} onChange={(e) => set("licenseHolderName", e.target.value)} /></Field>
        <Field label="License Number"><input value={form.licenseNumber} onChange={(e) => set("licenseNumber", e.target.value)} /></Field>
        <Field label="License State">
          <select value={form.licenseState} onChange={(e) => set("licenseState", e.target.value)}>
            <option value="">— select —</option>
            {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <p className="cp-hint">State that issued the company GC license (2-letter code)</p>
        <Field label="License Type"><input value={form.licenseType} onChange={(e) => set("licenseType", e.target.value)} placeholder="General Contractor, B, C-10..." /></Field>
        <p className="cp-hint">Type of license held by the company</p>

        <div className="cp-divider" />
        <div className="cp-tz-head">
          <span>🌐 Timezone</span>
          <button className="btn-ghost small" onClick={detectTimezone}>↻ Detect from address</button>
        </div>
        <Field label=""><select value={form.timezone} onChange={(e) => set("timezone", e.target.value)}>
            {TIMEZONES.map((tz) => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
          </select></Field>
        <p className="cp-hint">Used for SMS reminder windows, task due-date bucketing, and financial date fallbacks. All times shown to your team are in this timezone.</p>

        <div className="modal-actions">
          <div>{saved && <span className="cp-saved">✓ Saved</span>}</div>
          <div><button className="btn-primary" onClick={save}>Save Company Profile</button></div>
        </div>
      </div>
    </div>
  );
}

function AdminSettings({ companies, setCompanies, logo, setLogo, users, setUsers, companyProfile, setCompanyProfile }) {
  const [query, setQuery] = useState("");
  const [activeCard, setActiveCard] = useState(null);
  const [logoDraft, setLogoDraft] = useState(null);
  const [logoError, setLogoError] = useState("");
  const [newUser, setNewUser] = useState({ name: "", email: "", phone: "", company: "", roles: "" });

  const q = query.trim().toLowerCase();
  const filteredSections = SETTINGS_SECTIONS.map((sec) => ({
    ...sec,
    cards: q ? sec.cards.filter((c) => (c.title + " " + c.desc).toLowerCase().includes(q)) : sec.cards,
  })).filter((sec) => sec.cards.length > 0);

  function openCard(card) {
    if (card.key === "logo") { setLogoDraft(logo || null); setLogoError(""); }
    if (card.key === "users-roles") setNewUser({ name: "", email: "", phone: "", company: companies[0] || "", roles: "" });
    setActiveCard(card);
  }

  function handleLogoFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { setLogoError("Please choose an image file."); return; }
    if (file.size > 1.5 * 1024 * 1024) { setLogoError("Image is too large — please use one under 1.5MB."); return; }
    setLogoError("");
    const reader = new FileReader();
    reader.onload = () => setLogoDraft(reader.result);
    reader.onerror = () => setLogoError("Couldn't read that file — try again.");
    reader.readAsDataURL(file);
  }

  function saveLogo() {
    setLogo(logoDraft);
    setActiveCard(null);
  }

  function removeLogo() {
    setLogoDraft(null);
    setLogo(null);
  }

  if (activeCard && activeCard.key === "users-roles") {
    return (
      <UsersRolesPage
        users={users}
        setUsers={setUsers}
        companies={companies}
        newUser={newUser}
        setNewUser={setNewUser}
        onBack={() => setActiveCard(null)}
      />
    );
  }

  if (activeCard && activeCard.key === "company-profile") {
    return (
      <CompanyProfilePage
        companyProfile={companyProfile}
        setCompanyProfile={setCompanyProfile}
        setCompanies={setCompanies}
        onBack={() => setActiveCard(null)}
      />
    );
  }

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h2 className="module-title">Settings</h2>
          <p className="module-sub">Search or browse all company configuration</p>
        </div>
      </div>

      <input className="settings-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search settings" />

      <div className="chip-row">
        {SETTINGS_CATEGORIES.map((c) => (
          <span key={c} className="chip settings-chip">{c}</span>
        ))}
      </div>

      {filteredSections.length === 0 ? (
        <EmptyState label="No settings match" hint="Try a different search term." />
      ) : (
        filteredSections.map((sec) => (
          <div key={sec.category} className="settings-section">
            <div className="settings-section-head">
              <span className="settings-section-title">{sec.category.toUpperCase()}</span>
              <span className="settings-section-hint">{sec.hint}</span>
            </div>
            <div className="settings-grid">
              {sec.cards.map((c) => <SettingsCard key={c.title} card={c} onOpen={openCard} />)}
            </div>
          </div>
        ))
      )}

      {activeCard && activeCard.key === "logo" && (
        <Modal title="Logo" onClose={() => setActiveCard(null)}>
          <p className="hint-note" style={{ marginTop: 0 }}>Upload your company logo — it'll appear in the sidebar across the app.</p>
          <div className="logo-preview-wrap">
            {logoDraft ? (
              <img src={logoDraft} alt="Company logo preview" className="logo-preview-img" />
            ) : (
              <div className="logo-preview-empty">No logo uploaded</div>
            )}
          </div>
          <input type="file" accept="image/*" onChange={handleLogoFile} className="logo-file-input" />
          {logoError && <p className="logo-error">{logoError}</p>}
          <div className="modal-actions">
            <div className="modal-actions-left">
              {logoDraft && <button className="btn-danger-ghost" onClick={removeLogo}>Remove</button>}
            </div>
            <div>
              <button className="btn-ghost" onClick={() => setActiveCard(null)}>Cancel</button>
              <button className="btn-primary" onClick={saveLogo} disabled={!logoDraft && !logo}>Save</button>
            </div>
          </div>
        </Modal>
      )}
      {activeCard && activeCard.key === "pipeline-stages" && (
        <Modal title="Pipeline Stages" onClose={() => setActiveCard(null)}>
          <p className="hint-note" style={{ marginTop: 0 }}>Current stages used across the Pipeline board, in order:</p>
          <ol className="settings-stage-list">
            {LEAD_STAGES.map((s) => <li key={s}><span className="tick" style={{ background: STAGE_COLOR[s] }} /> {s}</li>)}
          </ol>
          <p className="hint-note">Reordering and adding custom stages isn't wired up in this prototype yet.</p>
          <div className="modal-actions">
            <div />
            <div><button className="btn-primary" onClick={() => setActiveCard(null)}>Close</button></div>
          </div>
        </Modal>
      )}
      {activeCard && !activeCard.key && (
        <Modal title={activeCard.title} onClose={() => setActiveCard(null)}>
          <p className="hint-note" style={{ marginTop: 0 }}>{activeCard.desc}</p>
          <p className="hint-note">This setting isn't wired up in the prototype yet — it's here to show where it'll live.</p>
          <div className="modal-actions">
            <div />
            <div><button className="btn-primary" onClick={() => setActiveCard(null)}>Close</button></div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ================= APP SHELL =================
const NAV = [
  { id: "dashboard", label: "Dashboard", icon: "◎" },
  { id: "pipeline", label: "Pipeline", icon: "▸" },
  { id: "production", label: "Production", icon: "▦" },
  { id: "documents", label: "Estimates & Invoices", icon: "▤" },
  { id: "calendar", label: "Calendar", icon: "📅" },
  { id: "schedule", label: "Schedule", icon: "▧" },
  { id: "contracts", label: "Contracts", icon: "✎" },
  { id: "settings", label: "Admin Settings", icon: "⚙" },
];

export default function App() {
  const [tabId, setTabId] = useState("dashboard");
  const [role, setRole] = useState("Office");
  const [loading, setLoading] = useState(true);
  const [quickCreate, setQuickCreate] = useState(null); // { module, ts }

  const [leads, setLeads] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [docs, setDocs] = useState([]);
  const [events, setEvents] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [companies, setCompanies] = useState(["LA Home Contractor DBA LA Home Restoration"]);
  const [logo, setLogo] = useState(null);
  const [users, setUsers] = useState([]);
  const DEFAULT_PROFILE = { address: "", email: "", name: "LA Home Contractor DBA LA Home Restoration", phone: "", website: "", licenseHolderName: "", licenseNumber: "", licenseState: "", licenseType: "", timezone: "Pacific" };
  const [companyProfile, setCompanyProfile] = useState(DEFAULT_PROFILE);

  useEffect(() => {
    (async () => {
      const [l, j, d, e, c, comp, lg, us, cp] = await Promise.all([
        loadKey("crm-leads", []),
        loadKey("crm-jobs", []),
        loadKey("crm-docs", []),
        loadKey("crm-events", []),
        loadKey("crm-contracts", []),
        loadKey("crm-companies", ["LA Home Contractor DBA LA Home Restoration"]),
        loadKey("crm-logo", null),
        loadKey("crm-users", []),
        loadKey("crm-company-profile", DEFAULT_PROFILE),
      ]);
      const STAGE_ALIASES = { "New Lead": "New Leads" };
      const normalizedLeads = l.map((lead) => (
        STAGE_ALIASES[lead.stage] ? { ...lead, stage: STAGE_ALIASES[lead.stage] } : lead
      ));
      setLeads(normalizedLeads); setJobs(j); setDocs(d); setEvents(e); setContracts(c); setCompanies(comp); setLogo(lg); setUsers(us); setCompanyProfile(cp);
      setLoading(false);
    })();
  }, []);

  useEffect(() => { if (!loading) saveKey("crm-leads", leads); }, [leads, loading]);
  useEffect(() => { if (!loading) saveKey("crm-jobs", jobs); }, [jobs, loading]);
  useEffect(() => { if (!loading) saveKey("crm-docs", docs); }, [docs, loading]);
  useEffect(() => { if (!loading) saveKey("crm-events", events); }, [events, loading]);
  useEffect(() => { if (!loading) saveKey("crm-contracts", contracts); }, [contracts, loading]);
  useEffect(() => { if (!loading) saveKey("crm-companies", companies); }, [companies, loading]);
  useEffect(() => { if (!loading) saveKey("crm-logo", logo); }, [logo, loading]);
  useEffect(() => { if (!loading) saveKey("crm-users", users); }, [users, loading]);
  useEffect(() => { if (!loading) saveKey("crm-company-profile", companyProfile); }, [companyProfile, loading]);

  function fireQuickCreate(module) {
    setTabId(module);
    setQuickCreate({ module, ts: Date.now() });
  }

  return (
    <div className="app-shell">
      <style>{`
        ${FONT_IMPORT}
        :root {
          --ink: #14202E;
          --ink-soft: #3A4A5E;
          --blueprint: #2D5F8A;
          --safety: #C7691B;
          --success: #2F855A;
          --danger: #C0392B;
          --paper: #F5F3EE;
          --line: #DDD8CC;
        }
        * { box-sizing: border-box; }
        .app-shell { min-height: 100vh; background: var(--paper); color: var(--ink); font-family: 'Inter', sans-serif; }
        .app-root { display: flex; flex-direction: column; min-height: 100vh; }
        .global-topbar { display: flex; justify-content: space-between; align-items: center; gap: 16px; background: #fff; border-bottom: 1px solid var(--line); padding: 10px 18px; position: sticky; top: 0; z-index: 30; }
        .global-topbar-left { display: flex; align-items: center; gap: 14px; flex: 1; min-width: 0; }
        .global-topbar-brand { font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 15px; letter-spacing: 0.03em; color: var(--ink); white-space: nowrap; }
        .topbar-logo-img { max-height: 28px; max-width: 140px; object-fit: contain; }
        .global-search { flex: 1; max-width: 420px; border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; font-size: 13px; background: var(--paper); }
        .global-topbar-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
        .app-body { display: flex; flex: 1; min-height: 0; }
        .mono { font-family: 'JetBrains Mono', monospace; }

        .sidebar { width: 220px; flex-shrink: 0; background: var(--ink); color: #E8ECF1; display: flex; flex-direction: column; }
        .sidebar-head { padding: 22px 18px 16px; border-bottom: 1px solid #26374A; }
        .sidebar-title { font-family: 'Oswald', sans-serif; font-weight: 700; letter-spacing: 0.04em; font-size: 15px; text-transform: uppercase; }
        .sidebar-sub { font-size: 11px; color: #8EA0B5; margin-top: 3px; }
        .sidebar-nav { flex: 1; padding: 10px 0; }
        .nav-item { display: flex; align-items: center; gap: 10px; padding: 11px 18px; font-size: 13.5px; color: #C3CEDA; cursor: pointer; border-left: 3px solid transparent; }
        .nav-item:hover { background: #1D2D3F; }
        .nav-item.active { background: #1D2D3F; color: #fff; border-left-color: var(--safety); }
        .nav-icon { width: 16px; text-align: center; opacity: 0.85; }
        .sidebar-foot { padding: 14px 18px; border-top: 1px solid #26374A; }
        .role-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #7C8CA0; margin-bottom: 6px; }
        .role-toggle { display: flex; gap: 6px; }
        .role-btn { flex: 1; font-size: 11.5px; padding: 6px 4px; border-radius: 4px; border: 1px solid #2C3E52; background: transparent; color: #9FB0C2; cursor: pointer; }
        .role-btn.active-office { background: var(--blueprint); border-color: var(--blueprint); color: #fff; }
        .role-btn.active-field { background: var(--safety); border-color: var(--safety); color: #fff; }

        .main { flex: 1; padding: 30px 36px; overflow-y: auto; }
        .module-toolbar { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 18px; }
        .module-title { font-family: 'Oswald', sans-serif; font-size: 24px; font-weight: 600; margin: 0; }
        .module-sub { color: var(--ink-soft); font-size: 13px; margin: 4px 0 0; }

        .btn-primary { background: var(--safety); color: #fff; border: none; padding: 9px 16px; border-radius: 6px; font-weight: 600; font-size: 13px; cursor: pointer; }
        .btn-primary:hover { background: #B25C17; }
        .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn-ghost { background: transparent; border: 1px solid var(--line); color: var(--ink); padding: 8px 14px; border-radius: 6px; font-size: 13px; cursor: pointer; margin-left: 8px; }
        .btn-ghost.small { padding: 5px 10px; font-size: 12px; margin: 6px 0 0; }
        .btn-danger-ghost { background: transparent; border: 1px solid #E2B4AC; color: var(--danger); padding: 8px 14px; border-radius: 6px; font-size: 13px; cursor: pointer; }
        .icon-btn { background: transparent; border: none; color: var(--ink-soft); cursor: pointer; font-size: 14px; }

        .chip-row { display: flex; gap: 8px; margin-bottom: 18px; }
        .chip { background: #fff; border: 1px solid var(--line); padding: 6px 13px; border-radius: 999px; font-size: 12.5px; cursor: pointer; color: var(--ink-soft); }
        .chip-active { background: var(--ink); color: #fff; border-color: var(--ink); }

        .stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 24px; }
        .stat-grid-5 { grid-template-columns: repeat(5, 1fr); }
        .stat-card { background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 16px 18px; cursor: pointer; }
        .stat-card:hover { border-color: var(--blueprint); }
        .stat-static { cursor: default; }
        .stat-static:hover { border-color: var(--line); }
        .stat-value { font-size: 26px; font-weight: 600; }
        .stat-label { font-size: 12px; color: var(--ink-soft); margin-top: 4px; text-transform: uppercase; letter-spacing: 0.03em; }

        .filter-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 10px; }
        .filter-bar-right { display: flex; align-items: center; gap: 6px; }
        .filter-label { font-size: 12px; color: var(--ink-soft); margin-right: 4px; }
        .no-margin { margin-bottom: 0; }
        .lead-card-name-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 6px; }
        .source-tag { font-size: 10px; background: #FBEFE3; color: var(--safety); border-radius: 4px; padding: 1px 6px; white-space: nowrap; }
        .lead-card-line { font-size: 11.5px; color: var(--ink-soft); margin-top: 3px; }
        .lead-card-project { font-size: 11.5px; font-style: italic; color: var(--blueprint); margin-top: 3px; }
        .stale-tag { color: var(--danger); font-size: 10.5px; font-weight: 600; }
        .segmented { display: flex; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
        .segmented-btn { flex: 1; background: #fff; border: none; padding: 8px 6px; font-size: 12px; cursor: pointer; color: var(--ink-soft); }
        .segmented-btn.active { background: var(--ink); color: #fff; }
        .second-contact-block { background: #FAF8F3; border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; margin: 4px 0 14px; }
        .second-contact-head { display: flex; justify-content: space-between; font-size: 12px; font-weight: 600; color: var(--ink-soft); text-transform: uppercase; margin-bottom: 8px; }
        .draft-banner { display: flex; justify-content: space-between; align-items: center; background: #F0EDE4; border: 1px solid var(--line); border-radius: 6px; padding: 9px 12px; font-size: 12px; color: var(--ink-soft); margin-bottom: 14px; }
        .draft-discard { background: transparent; border: none; color: var(--danger); font-size: 12px; cursor: pointer; font-weight: 600; }
        .entry-mode-toggle { max-width: 280px; margin-bottom: 16px; }
        .csv-map-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin: 12px 0 16px; }
        .csv-usable-note { font-size: 12.5px; color: var(--ink-soft); background: #FAF8F3; border: 1px solid var(--line); border-radius: 6px; padding: 8px 12px; margin-bottom: 14px; }
        .csv-usable-warn { color: var(--safety); background: #FBEFE3; border-color: #E8CBA5; }
        .csv-preview { margin-bottom: 12px; }
        .csv-preview-label { font-size: 11px; text-transform: uppercase; color: var(--ink-soft); margin-bottom: 6px; font-weight: 600; }
        .btn-danger-ghost.small { padding: 5px 10px; font-size: 11.5px; }
        .wizard-sub { font-size: 12.5px; color: var(--ink-soft); margin: -4px 0 14px; }
        .wizard-step { border: 1px solid var(--line); border-radius: 8px; margin-bottom: 10px; background: #FAF8F3; }
        .wizard-step-active { background: #fff; border-color: var(--blueprint); }
        .wizard-step-head { display: flex; align-items: center; gap: 10px; padding: 12px 14px; }
        .step-num { width: 22px; height: 22px; border-radius: 50%; background: var(--ink); color: #fff; font-size: 11.5px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .step-done { background: var(--success); }
        .step-label { font-weight: 600; font-size: 13.5px; }
        .step-optional { font-weight: 400; color: var(--ink-soft); font-size: 11.5px; }
        .step-hint { margin-left: auto; font-size: 11.5px; color: var(--ink-soft); }
        .wizard-step-body { padding: 0 14px 14px; }
        .contact-match-list { border: 1px solid var(--line); border-radius: 6px; margin-top: -6px; margin-bottom: 10px; overflow: hidden; background: #fff; }
        .contact-match-row { padding: 8px 12px; font-size: 12.5px; cursor: pointer; border-bottom: 1px solid #F0EDE4; }
        .contact-match-row:last-child { border-bottom: none; }
        .contact-match-row:hover { background: #FAF8F3; }
        .wizard-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
        .wizard-footer { border-top: 1px solid var(--line); padding-top: 14px; margin-top: 4px; }
        .wizard-footer-right { display: flex; align-items: center; gap: 14px; }
        .step-indicator { font-size: 11.5px; color: var(--ink-soft); }

        .topbar { display: flex; justify-content: flex-end; align-items: center; margin-bottom: 18px; }
        .quick-create-wrap { position: relative; }
        .quick-create-btn { padding: 9px 16px; }
        .quick-create-backdrop { position: fixed; inset: 0; z-index: 39; }
        .quick-create-menu { position: absolute; right: 0; top: calc(100% + 6px); width: 240px; background: #fff; border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 10px 30px rgba(20,32,46,0.18); padding: 8px 0; z-index: 40; max-height: 70vh; overflow-y: auto; }
        .qc-group { padding: 6px 0; border-bottom: 1px solid #F0EDE4; }
        .qc-group:last-child { border-bottom: none; }
        .qc-group-label { font-size: 10.5px; font-weight: 700; letter-spacing: 0.04em; color: var(--ink-soft); padding: 6px 16px 4px; }
        .qc-item { padding: 8px 16px; font-size: 13px; cursor: pointer; color: var(--ink); }
        .qc-item:hover { background: #FAF8F3; color: var(--safety); }

        .settings-search { width: 100%; max-width: 480px; border: 1px solid var(--line); border-radius: 8px; padding: 10px 14px; font-size: 13px; margin-bottom: 14px; background: #fff; }
        .settings-chip { cursor: default; }
        .settings-section { margin-top: 26px; }
        .settings-section-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
        .settings-section-title { font-size: 11.5px; font-weight: 700; letter-spacing: 0.04em; color: var(--ink); }
        .settings-section-hint { font-size: 12px; color: var(--ink-soft); }
        .settings-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
        .settings-card { display: flex; gap: 12px; background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 14px; cursor: pointer; }
        .settings-card:hover { border-color: var(--blueprint); }
        .settings-card-icon { font-size: 16px; flex-shrink: 0; }
        .settings-card-title { font-weight: 600; font-size: 13px; margin-bottom: 3px; }
        .settings-card-desc { font-size: 11.5px; color: var(--ink-soft); line-height: 1.4; }
        .settings-stage-list { list-style: none; padding: 0; margin: 0 0 12px; display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
        .settings-stage-list li { display: flex; align-items: center; gap: 8px; }
        .logo-preview-wrap { border: 1px dashed var(--line); border-radius: 8px; padding: 18px; display: flex; align-items: center; justify-content: center; margin-bottom: 12px; background: #FAF8F3; min-height: 90px; }
        .logo-preview-img { max-height: 80px; max-width: 100%; object-fit: contain; }
        .logo-preview-empty { font-size: 12.5px; color: var(--ink-soft); }
        .logo-file-input { font-size: 12.5px; }
        .logo-error { color: var(--danger); font-size: 12px; margin-top: 8px; }
        .sidebar-logo-img { max-height: 34px; max-width: 100%; object-fit: contain; }
        .user-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; }
        .user-row { display: flex; align-items: center; gap: 10px; border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; background: #FAF8F3; }
        .user-row-info { flex: 1; min-width: 0; }
        .user-row-name { font-weight: 600; font-size: 13px; }
        .user-row-email { font-size: 11.5px; color: var(--ink-soft); }
        .user-add-row { display: grid; grid-template-columns: 1.2fr 1.4fr 0.8fr auto; gap: 8px; align-items: center; border-top: 1px solid var(--line); padding-top: 14px; }
        .btn-primary.small { padding: 8px 12px; font-size: 12.5px; }

        .ur-breadcrumb { font-size: 12px; color: var(--ink-soft); margin-bottom: 10px; }
        .ur-crumb-link { cursor: pointer; }
        .ur-crumb-link:hover { color: var(--blueprint); text-decoration: underline; }
        .ur-guide-banner { display: flex; gap: 12px; background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 14px 16px; margin-bottom: 16px; }
        .ur-guide-icon { font-size: 18px; }
        .ur-guide-title { font-weight: 600; font-size: 13.5px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .ur-guide-badge { font-size: 10px; background: #FBEFE3; color: var(--safety); border-radius: 4px; padding: 2px 7px; font-weight: 600; text-transform: uppercase; }
        .ur-guide-desc { font-size: 12px; color: var(--ink-soft); margin-top: 4px; }
        .ur-filter-bar { display: flex; gap: 10px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; }
        .ur-search { flex: 1; min-width: 200px; border: 1px solid var(--line); border-radius: 8px; padding: 9px 12px; font-size: 13px; background: #fff; }
        .ur-company-filter { border: 1px solid var(--line); border-radius: 8px; padding: 9px 10px; font-size: 12.5px; background: #fff; }
        .ur-table th:last-child, .ur-table td:last-child { text-align: right; }
        .ur-name-cell { display: flex; align-items: center; gap: 10px; }
        .ur-avatar { width: 30px; height: 30px; border-radius: 50%; background: var(--blueprint); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; flex-shrink: 0; }
        .ur-name { font-weight: 600; font-size: 13px; margin-bottom: 2px; }
        .ur-add-phone { color: var(--ink-soft); font-size: 12px; }
        .ur-role-badges { display: flex; flex-wrap: wrap; gap: 5px; }
        .ur-toggle-btn { background: none; border: none; cursor: pointer; padding: 0; }
        .toggle-track { display: inline-block; width: 36px; height: 20px; border-radius: 999px; background: #D9D4C7; position: relative; transition: background 0.15s; }
        .toggle-track.toggle-on { background: var(--success); }
        .toggle-thumb { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: left 0.15s; }
        .toggle-track.toggle-on .toggle-thumb { left: 18px; }

        .cp-card { background: #fff; border: 1px solid var(--line); border-radius: 10px; padding: 20px 22px; max-width: 640px; }
        .cp-card-head { font-weight: 600; font-size: 14px; color: var(--blueprint); margin-bottom: 4px; }
        .cp-card-sub { font-size: 12px; color: var(--ink-soft); margin: 0 0 18px; }
        .cp-card .field { margin-bottom: 14px; }
        .cp-hint { font-size: 11.5px; color: var(--ink-soft); margin: -8px 0 14px; }
        .cp-saved { color: var(--success); font-size: 12.5px; font-weight: 600; }
        .cp-divider { border-top: 1px solid var(--line); margin: 6px 0 16px; }
        .cp-tz-head { display: flex; justify-content: space-between; align-items: center; font-weight: 600; font-size: 13.5px; margin-bottom: 10px; }

        @media (max-width: 1100px) {
          .settings-grid { grid-template-columns: repeat(2, 1fr); }
        }
        @media (max-width: 700px) {
          .settings-grid { grid-template-columns: 1fr; }
        }

        .dash-lower { display: grid; grid-template-columns: 1.3fr 1fr; gap: 16px; }
        .dash-panel { background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 16px 18px; }
        .dash-panel h3 { font-family: 'Oswald', sans-serif; font-size: 14px; margin: 0 0 10px; text-transform: uppercase; letter-spacing: 0.03em; }
        .dash-list { list-style: none; padding: 0; margin: 0; font-size: 13px; }
        .dash-list li { padding: 6px 0; border-bottom: 1px solid #F0EDE4; display: flex; align-items: center; gap: 6px; }
        .dash-list li:last-child { border-bottom: none; }

        .pipeline-board { display: grid; grid-template-columns: repeat(7, minmax(150px, 1fr)); gap: 10px; overflow-x: auto; }
        .pipeline-col { background: #FAF8F3; border: 1px solid var(--line); border-radius: 8px; min-width: 150px; }
        .pipeline-col-head { display: flex; align-items: center; gap: 6px; padding: 10px 10px; font-size: 11.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.02em; border-bottom: 1px solid var(--line); }
        .tick { width: 7px; height: 7px; border-radius: 1px; display: inline-block; }
        .count-pill { margin-left: auto; background: #E8E4D8; border-radius: 999px; padding: 1px 7px; font-size: 11px; }
        .pipeline-col-body { padding: 8px; display: flex; flex-direction: column; gap: 8px; min-height: 60px; }
        .lead-card { background: #fff; border: 1px solid var(--line); border-radius: 6px; padding: 9px 10px; cursor: grab; }
        .lead-card-dragging { opacity: 0.4; }
        .pipeline-col-dragover { outline: 2px dashed var(--blueprint); outline-offset: -2px; background: #EEF3F8; }
        .lead-card:hover { border-color: var(--blueprint); }
        .lead-card-name { font-weight: 600; font-size: 13px; }
        .lead-card-meta { font-size: 11.5px; color: var(--ink-soft); margin-top: 2px; }
        .lead-card-foot { display: flex; justify-content: space-between; margin-top: 6px; font-size: 11.5px; color: var(--ink-soft); }

        .job-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
        .job-card { background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 14px; cursor: pointer; }
        .job-card:hover { border-color: var(--blueprint); }
        .job-card-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
        .job-name { font-weight: 600; font-size: 14px; }
        .job-address { font-size: 12.5px; color: var(--ink-soft); margin-top: 5px; }
        .job-meta-row { display: flex; gap: 12px; font-size: 11.5px; color: var(--ink-soft); margin-top: 10px; flex-wrap: wrap; }

        .badge-chip { border: 1px solid; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; white-space: nowrap; }

        .data-table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
        .data-table th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; color: var(--ink-soft); padding: 10px 14px; border-bottom: 1px solid var(--line); }
        .data-table td { padding: 11px 14px; border-bottom: 1px solid #F0EDE4; font-size: 13px; cursor: pointer; }
        .data-table tr:hover td { background: #FAF8F3; }
        .data-table .right { text-align: right; }

        .schedule-list { display: flex; flex-direction: column; gap: 8px; }

        .cal-toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
        .cal-nav { display: flex; align-items: center; gap: 10px; }
        .cal-nav-btn { font-size: 18px; padding: 2px 8px; }
        .cal-month-label { font-family: 'Oswald', sans-serif; font-weight: 600; font-size: 16px; min-width: 160px; text-align: center; }
        .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; background: var(--line); gap: 1px; }
        .cal-weekday { background: #FAF8F3; padding: 8px; font-size: 11px; text-transform: uppercase; color: var(--ink-soft); font-weight: 600; text-align: center; }
        .cal-cell { background: #fff; min-height: 90px; padding: 6px; cursor: pointer; display: flex; flex-direction: column; gap: 4px; }
        .cal-cell:hover { background: #FAF8F3; }
        .cal-cell-out { background: #FBFAF7; color: var(--ink-soft); }
        .cal-cell-out .cal-cell-day { color: #B9B3A3; }
        .cal-cell-today .cal-cell-day { background: var(--safety); color: #fff; border-radius: 50%; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; }
        .cal-cell-selected { outline: 2px solid var(--blueprint); outline-offset: -2px; }
        .cal-cell-day { font-size: 12px; font-weight: 600; }
        .cal-cell-events { display: flex; flex-direction: column; gap: 2px; }
        .cal-event-chip { background: #E9F0F6; color: var(--blueprint); border-radius: 4px; padding: 2px 5px; font-size: 10.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .cal-event-chip:hover { background: #D6E4EF; }
        .cal-event-time { font-size: 10px; }
        .cal-event-more { font-size: 10px; color: var(--ink-soft); padding-left: 5px; }
        .cal-day-panel { background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 14px 16px; margin-top: 14px; }
        .cal-day-panel-head { display: flex; justify-content: space-between; align-items: center; font-weight: 600; font-size: 13.5px; margin-bottom: 10px; }
        .schedule-row { background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; display: flex; gap: 16px; cursor: pointer; align-items: center; }
        .schedule-row:hover { border-color: var(--blueprint); }
        .schedule-date { display: flex; flex-direction: column; align-items: center; min-width: 80px; border-right: 1px solid var(--line); padding-right: 14px; }
        .schedule-date-num { font-size: 12.5px; font-weight: 600; }
        .schedule-time { font-size: 11.5px; color: var(--ink-soft); }
        .schedule-title { font-weight: 600; font-size: 13.5px; }
        .schedule-meta { display: flex; gap: 10px; align-items: center; font-size: 11.5px; color: var(--ink-soft); margin-top: 5px; flex-wrap: wrap; }

        .empty-state { background: #fff; border: 1px dashed var(--line); border-radius: 8px; padding: 40px 20px; text-align: center; }
        .empty-mark { font-size: 22px; color: var(--safety); }
        .empty-label { font-weight: 600; margin: 8px 0 2px; }
        .empty-hint { font-size: 12.5px; color: var(--ink-soft); margin: 0; }

        .modal-backdrop { position: fixed; inset: 0; background: rgba(20,32,46,0.45); display: flex; align-items: center; justify-content: center; z-index: 50; padding: 20px; }
        .modal { background: #fff; border-radius: 10px; width: 100%; max-width: 460px; max-height: 88vh; overflow-y: auto; }
        .modal-wide { max-width: 640px; }
        .modal-head { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid var(--line); }
        .modal-head h3 { margin: 0; font-family: 'Oswald', sans-serif; font-size: 16px; }
        .modal-body { padding: 18px 20px 20px; }
        .modal-actions { display: flex; justify-content: space-between; margin-top: 16px; }
        .modal-actions-left { display: flex; gap: 8px; align-items: center; }

        .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
        .field { display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; }
        .field-label { color: var(--ink-soft); font-weight: 600; }
        .field input, .field select, .field textarea, .line-item-row input {
          border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; font-size: 13px; font-family: 'Inter', sans-serif; background: #FEFDFB;
        }
        .field input:focus, .field select:focus, .field textarea:focus { outline: 2px solid var(--blueprint); outline-offset: 1px; border-color: var(--blueprint); }
        .hint-note { font-size: 11.5px; color: var(--ink-soft); font-style: italic; margin: 4px 0 0; }

        .line-items { margin-top: 6px; }
        .line-items-head { font-size: 11px; text-transform: uppercase; color: var(--ink-soft); margin-bottom: 6px; }
        .line-item-card { border: 1px solid var(--line); border-radius: 8px; padding: 10px; margin-bottom: 8px; background: #FAF8F3; }
        .line-item-desc-row { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
        .line-item-desc-row input { flex: 1; }
        .line-item-nums-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
        .line-num-field { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
        .line-num-label { font-size: 10px; text-transform: uppercase; color: var(--ink-soft); font-weight: 600; }
        .line-num-field input { width: 100%; }
        .line-subtotal { font-size: 13px; border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; background: #F0EDE4; color: var(--ink); font-weight: 600; }
        .doc-total { text-align: right; font-weight: 600; font-size: 15px; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--line); }
        .doc-total .mono { margin-left: 8px; }

        @media (max-width: 900px) {
          .cal-cell { min-height: 64px; }
          .cal-event-chip { font-size: 9.5px; }
          .app-body { flex-direction: column; }
          .sidebar { width: 100%; flex-direction: row; overflow-x: auto; }
          .sidebar-nav { display: flex; }
          .global-search { display: none; }
          .stat-grid { grid-template-columns: repeat(2, 1fr); }
          .dash-lower { grid-template-columns: 1fr; }
          .pipeline-board { grid-template-columns: repeat(7, 200px); }
          .form-grid { grid-template-columns: 1fr; }
          .user-add-row { grid-template-columns: 1fr; }
          .user-row { flex-wrap: wrap; }
          .csv-map-grid { grid-template-columns: 1fr; }
        }
      `}</style>

      <div className="app-root">
        <div className="global-topbar">
          <div className="global-topbar-left">
            {logo ? (
              <img src={logo} alt="Company logo" className="topbar-logo-img" />
            ) : (
              <span className="global-topbar-brand">Contractor CRM</span>
            )}
            <input className="global-search" placeholder="Search for Anything" />
          </div>
          <div className="global-topbar-right">
            <QuickCreateMenu onPick={fireQuickCreate} />
          </div>
        </div>

        <div className="app-body">
          <aside className="sidebar">
            <div className="sidebar-head">
              {logo ? (
                <img src={logo} alt="Company logo" className="sidebar-logo-img" />
              ) : (
                <div className="sidebar-title">Contractor CRM</div>
              )}
              <div className="sidebar-sub">Prototype v0.1</div>
            </div>
            <nav className="sidebar-nav">
              {NAV.map((n) => (
                <div key={n.id} className={"nav-item" + (tabId === n.id ? " active" : "")} onClick={() => setTabId(n.id)}>
                  <span className="nav-icon">{n.icon}</span>{n.label}
                </div>
              ))}
            </nav>
            <div className="sidebar-foot">
              <div className="role-label">Viewing as</div>
              <div className="role-toggle">
                <button className={"role-btn" + (role === "Office" ? " active-office" : "")} onClick={() => setRole("Office")}>Office</button>
                <button className={"role-btn" + (role === "Field" ? " active-field" : "")} onClick={() => setRole("Field")}>Field</button>
              </div>
            </div>
          </aside>

          <main className="main">
            {loading ? (
              <p>Loading…</p>
            ) : tabId === "dashboard" ? (
              <Dashboard leads={leads} jobs={jobs} docs={docs} events={events} contracts={contracts} setTabId={setTabId} />
            ) : tabId === "pipeline" ? (
              <Pipeline leads={leads} setLeads={setLeads} jobs={jobs} setJobs={setJobs} events={events} setEvents={setEvents} role={role} openTrigger={quickCreate && quickCreate.module === "pipeline" ? quickCreate.ts : null} />
            ) : tabId === "production" ? (
              <Production jobs={jobs} setJobs={setJobs} openTrigger={quickCreate && quickCreate.module === "production" ? quickCreate.ts : null} />
            ) : tabId === "documents" ? (
              <Documents docs={docs} setDocs={setDocs} jobs={jobs} leads={leads} openTrigger={quickCreate && quickCreate.module === "documents" ? quickCreate.ts : null} />
            ) : tabId === "calendar" ? (
              <CalendarView events={events} setEvents={setEvents} jobs={jobs} leads={leads} openTrigger={quickCreate && quickCreate.module === "calendar" ? quickCreate.ts : null} />
            ) : tabId === "schedule" ? (
              <Schedule events={events} setEvents={setEvents} jobs={jobs} leads={leads} setLeads={setLeads} openTrigger={quickCreate && quickCreate.module === "schedule" ? quickCreate.ts : null} />
            ) : tabId === "contracts" ? (
              <Contracts contracts={contracts} setContracts={setContracts} jobs={jobs} openTrigger={quickCreate && quickCreate.module === "contracts" ? quickCreate.ts : null} />
            ) : tabId === "settings" ? (
              <AdminSettings companies={companies} setCompanies={setCompanies} logo={logo} setLogo={setLogo} users={users} setUsers={setUsers} companyProfile={companyProfile} setCompanyProfile={setCompanyProfile} />
            ) : null}
          </main>
        </div>
      </div>
    </div>
  );
}

function QuickCreateMenu({ onPick }) {
  const [open, setOpen] = useState(false);
  const groups = [
    { label: "Pipeline", items: [
      { label: "New Leads", module: "pipeline" },
      { label: "New Contact", module: "pipeline" },
      { label: "New Appointment", module: "schedule" },
    ]},
    { label: "Production", items: [
      { label: "New Job", module: "production" },
    ]},
    { label: "Estimates & Invoices", items: [
      { label: "New Estimate", module: "documents" },
      { label: "New Invoice", module: "documents" },
    ]},
    { label: "Contracts", items: [
      { label: "New Contract", module: "contracts" },
    ]},
  ];
  return (
    <div className="quick-create-wrap">
      <button className="btn-primary quick-create-btn" onClick={() => setOpen((o) => !o)}>+ Quick Create</button>
      {open && (
        <>
          <div className="quick-create-backdrop" onClick={() => setOpen(false)} />
          <div className="quick-create-menu">
            {groups.map((g) => (
              <div key={g.label} className="qc-group">
                <div className="qc-group-label">{g.label.toUpperCase()}</div>
                {g.items.map((it) => (
                  <div key={it.label} className="qc-item" onClick={() => { onPick(it.module); setOpen(false); }}>
                    {it.label}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
