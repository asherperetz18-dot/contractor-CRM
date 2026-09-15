"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import * as XLSX from "xlsx";
import { Field } from "@/components/ui/field";
import {
  ADDRESS_TYPES,
  CALL_ATTEMPTS_FILTERS,
  NO_DISPOSITION,
  leadDisplayName,
  normalizePhone,
  type CallAttemptsFilter,
  type CallDispositionRow,
  type DialList,
  type Lead,
  type PipelineStageRow,
  type Profile,
} from "@/lib/data/types";
import { deleteDialList, saveDialList } from "@/lib/actions/dial-lists";
import { getDialSessionLeads, listDialContacts, matchDialCsvPhones } from "@/lib/actions/dial-contacts";
import {
  DIAL_PAGE_SIZE,
  type DialContactPage,
  type DialContactRow,
} from "@/lib/dial-filters";
import type { LeadCallInfo } from "@/lib/lead-call-info";
import { DialSession } from "./dial-session";
import type { CompanyPhoneNumber } from "@/lib/actions/phone-numbers";

type Tab = "contact" | "lead";
type LeadStatus = "Open" | "Won" | "Lost";

function leadStatus(lead: Pick<DialContactRow, "stage">): LeadStatus {
  if (lead.stage === "Won") return "Won";
  if (lead.stage === "Lost") return "Lost";
  return "Open";
}

/**
 * The date filter as an ISO lower bound, computed here rather than on
 * the server so "Today" means the rep's calendar day, not UTC's.
 */
function createdSinceFor(filter: string): string {
  const now = new Date();
  if (filter === "Today") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return start.toISOString();
  }
  if (filter === "This Week") {
    const weekAgo = new Date(now);
    weekAgo.setDate(now.getDate() - 7);
    return weekAgo.toISOString();
  }
  if (filter === "This Month") {
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  }
  return "";
}

export function DialQueueView({
  initialContacts,
  stages,
  reps,
  dispositions,
  dialLists,
  callScript,
  canWrite,
  phoneNumbers,
}: {
  initialContacts: DialContactPage;
  stages: PipelineStageRow[];
  reps: Profile[];
  dispositions: CallDispositionRow[];
  dialLists: DialList[];
  callScript: string | null;
  canWrite: boolean;
  phoneNumbers: CompanyPhoneNumber[];
}) {
  const router = useRouter();
  const csvInputRef = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState<Tab>("contact");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [session, setSession] = useState<{
    leads: Lead[];
    callInfo: Record<string, LeadCallInfo>;
  } | null>(null);

  const [callAttempts, setCallAttempts] = useState<CallAttemptsFilter>("All");
  const [dispositionFilter, setDispositionFilter] = useState(NO_DISPOSITION);
  const [addressTypeFilter, setAddressTypeFilter] = useState("All");

  const [statusFilter, setStatusFilter] = useState<"All" | LeadStatus>("All");
  const [stageFilter, setStageFilter] = useState("All");
  const [repFilter, setRepFilter] = useState("All");
  const [dateFilter, setDateFilter] = useState("All Dates");

  // Which company number this desk shows when calling. Shared with the
  // floating dialer through localStorage plus an event, so picking it
  // here is picking it everywhere.
  const [callerPick, setCallerPick] = useState("");
  useEffect(() => {
    if (phoneNumbers.length < 2) return;
    // Through a timeout so hydration finishes on the server-rendered
    // value before the device's remembered pick is applied.
    const t = setTimeout(() => {
      const stored = window.localStorage.getItem("crm:dialer-caller-id");
      const pick =
        (stored && phoneNumbers.find((n) => n.phone_number === stored)) ||
        phoneNumbers.find((n) => n.is_default) ||
        phoneNumbers[0];
      setCallerPick(pick.phone_number);
    }, 0);
    return () => clearTimeout(t);
  }, [phoneNumbers]);

  function pickCallerId(value: string) {
    setCallerPick(value);
    window.localStorage.setItem("crm:dialer-caller-id", value);
    window.dispatchEvent(new CustomEvent("crm:caller-id-changed", { detail: { phone: value } }));
  }

  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveError, setSaveError] = useState("");
  const [savePending, setSavePending] = useState(false);
  const [csvStatus, setCsvStatus] = useState("");

  const repById = useMemo(() => new Map(reps.map((r) => [r.id, r])), [reps]);

  function setTabAndReset(t: Tab) {
    setTab(t);
    setPage(1);
  }

  /**
   * The page of rows on screen, asked of the server per filter change.
   * The whole book used to arrive as a prop and get filtered here --
   * at 79k contacts that meant a page that took ages to open, so the
   * browser now holds 50 rows and a total, nothing more.
   */
  const [contactPage, setContactPage] = useState<DialContactPage>(initialContacts);
  const [loadingRows, setLoadingRows] = useState(false);
  /** Bumped when a dial session closes, so the list reflects the
   *  dispositions it just recorded. */
  const [listRefresh, setListRefresh] = useState(0);
  const firstQueryRef = useRef(true);
  // Newest query wins: a slow response for a filter the rep already
  // left must not overwrite the list they are looking at.
  const queryIdRef = useRef(0);
  useEffect(() => {
    // The server rendered page 1 of the default filters; skip refetching it.
    if (firstQueryRef.current) {
      firstQueryRef.current = false;
      return;
    }
    const id = ++queryIdRef.current;
    setLoadingRows(true);
    const run = () => {
      listDialContacts({
        tab,
        search,
        page,
        callAttempts,
        dispositionFilter,
        addressTypeFilter,
        statusFilter,
        stageFilter,
        repFilter,
        createdSince: createdSinceFor(dateFilter),
      })
        .then((result) => {
          if (queryIdRef.current !== id) return;
          setContactPage(result);
        })
        .finally(() => {
          if (queryIdRef.current === id) setLoadingRows(false);
        });
    };
    // Typing debounces; a filter click still feels immediate because
    // 250ms is under the reaction time of reading the new list anyway.
    const t = setTimeout(run, 250);
    return () => clearTimeout(t);
  }, [tab, search, page, callAttempts, dispositionFilter, addressTypeFilter, statusFilter, stageFilter, repFilter, dateFilter, listRefresh]);

  const pageRows = contactPage.rows;
  const total = contactPage.total;
  const totalPages = Math.max(1, Math.ceil(total / DIAL_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allOnPageSelected = pageRows.length > 0 && pageRows.every((l) => selected.has(l.id));
  function toggleSelectAllOnPage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        for (const l of pageRows) next.delete(l.id);
      } else {
        for (const l of pageRows) next.add(l.id);
      }
      return next;
    });
  }

  function callLead(lead: DialContactRow) {
    window.dispatchEvent(
      new CustomEvent("crm:call", { detail: { phone: lead.phone, leadId: lead.id } })
    );
  }

  const [startingSession, setStartingSession] = useState(false);
  async function startDialing() {
    if (selected.size === 0 || startingSession) return;
    setStartingSession(true);
    try {
      // The session works the full card (quick-edit, maps link), so the
      // real rows are fetched now, for just the selection -- ids whose
      // lead has meanwhile been deleted simply come back absent. The
      // rep's local midnight rides along so "already called today" means
      // their calendar day, not the server's.
      const today = new Date();
      const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const result = await getDialSessionLeads([...selected], midnight.toISOString());
      if (result.leads.length > 0) setSession(result);
    } finally {
      setStartingSession(false);
    }
  }

  async function handleSaveList() {
    if (!saveName.trim()) {
      setSaveError("List name is required.");
      return;
    }
    setSavePending(true);
    setSaveError("");
    const result = await saveDialList(saveName, [...selected]);
    setSavePending(false);
    if (result.error) {
      setSaveError(result.error);
      return;
    }
    setShowSaveModal(false);
    setSaveName("");
    router.refresh();
  }

  function loadList(list: DialList) {
    // Ids are taken as saved; one whose lead has since been deleted is
    // dropped when the session fetches the real rows.
    setSelected(new Set(list.lead_ids));
  }

  async function handleDeleteList(list: DialList) {
    if (!confirm(`Delete the saved list "${list.name}"?`)) return;
    await deleteDialList(list.id);
    router.refresh();
  }

  function handleCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvStatus("");

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as unknown[][];
        if (!json.length) {
          setCsvStatus("That file looks empty.");
          return;
        }
        const headerRow = (json[0] as unknown[]).map((h) => String(h ?? "").trim().toLowerCase());
        let phoneCol = headerRow.findIndex((h) => /phone|mobile|cell/.test(h));
        const body = json.slice(phoneCol === -1 ? 0 : 1);
        if (phoneCol === -1) phoneCol = 0;

        // The file's numbers, normalized. Matching happens server-side
        // against every phone the company's contacts carry -- the page
        // no longer holds the contact book to match against here.
        const rowKeys: string[] = [];
        for (const row of body) {
          const raw = String((row as unknown[])[phoneCol] ?? "").trim();
          if (!raw) continue;
          rowKeys.push(normalizePhone(raw));
        }
        setCsvStatus("Matching…");
        const matches = await matchDialCsvPhones([...new Set(rowKeys)]);
        const leadByKey = new Map(matches.map((m) => [m.key, m.leadId]));

        let matched = 0;
        let skipped = 0;
        const matchedIds = new Set<string>();
        for (const key of rowKeys) {
          const leadId = leadByKey.get(key);
          if (leadId) {
            matchedIds.add(leadId);
            matched += 1;
          } else {
            skipped += 1;
          }
        }
        setSelected((prev) => new Set([...prev, ...matchedIds]));
        setCsvStatus(
          `Matched ${matched} phone number${matched === 1 ? "" : "s"} to existing contacts and added them to your selection.` +
            (skipped ? ` ${skipped} number${skipped === 1 ? "" : "s"} didn't match anyone.` : "")
        );
      } catch {
        setCsvStatus("Couldn't read that file — make sure it's a .csv or .xlsx export.");
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  }

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Power Dialer</h1>
          <p className="module-sub">Build a call list · Start a session · Track progress</p>
        </div>
        <div>
          <Link href="/settings/call-dispositions" className="btn-ghost small" style={{ marginRight: 8 }}>
            💬 Dispositions &amp; Follow-ups
          </Link>
          <Link href="/settings/call-scripts" className="btn-ghost small">
            📝 Call Scripts
          </Link>
        </div>
      </div>

      <div className="chip-row no-margin ta-tabs">
        <button
          className={"chip" + (tab === "contact" ? " chip-active" : "")}
          onClick={() => setTabAndReset("contact")}
        >
          By Contact
        </button>
        <button
          className={"chip" + (tab === "lead" ? " chip-active" : "")}
          onClick={() => setTabAndReset("lead")}
        >
          By Lead
        </button>
      </div>

      <div className="dial-queue-layout">
        <div className="dial-queue-main">
          <div className="dial-queue-filters">
            <input
              className="ur-search"
              style={{ marginBottom: 0, maxWidth: 320 }}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Name or phone…"
            />

            {tab === "contact" ? (
              <>
                <div className="dial-queue-filter-row">
                  <span className="dial-queue-filter-label">Call Attempts</span>
                  <div className="dial-queue-toggle-row">
                    {CALL_ATTEMPTS_FILTERS.map((f) => (
                      <button
                        key={f}
                        className={
                          "dial-queue-toggle" + (callAttempts === f ? " dial-queue-toggle-active" : "")
                        }
                        onClick={() => {
                          setCallAttempts(f);
                          setPage(1);
                        }}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="dial-queue-filter-row">
                  <span className="dial-queue-filter-label">Disposition</span>
                  <select
                    value={dispositionFilter}
                    onChange={(e) => {
                      setDispositionFilter(e.target.value);
                      setPage(1);
                    }}
                  >
                    <option value={NO_DISPOSITION}>{NO_DISPOSITION}</option>
                    <option value="Any Disposition">Any Disposition</option>
                    {dispositions
                      .filter((d) => d.name !== NO_DISPOSITION)
                      .map((d) => (
                        <option key={d.id} value={d.name}>
                          {d.name}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="dial-queue-filter-row">
                  <span className="dial-queue-filter-label">Address Type</span>
                  <select
                    value={addressTypeFilter}
                    onChange={(e) => {
                      setAddressTypeFilter(e.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="All">All address types</option>
                    {ADDRESS_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="hint-note" style={{ margin: 0 }}>
                  {dispositionFilter === NO_DISPOSITION
                    ? "Showing contacts you haven't set a disposition for yet — your fresh call list. Switch the filters above to build a different list."
                    : `Showing ${total} contact${total === 1 ? "" : "s"} matching your filters.`}
                </p>
              </>
            ) : (
              <div className="dial-queue-filter-row">
                <select
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value as "All" | LeadStatus);
                    setPage(1);
                  }}
                >
                  <option value="All">All Statuses</option>
                  <option value="Open">Open</option>
                  <option value="Won">Won</option>
                  <option value="Lost">Lost</option>
                </select>
                <select
                  value={stageFilter}
                  onChange={(e) => {
                    setStageFilter(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="All">All Stages</option>
                  {stages.map((s) => (
                    <option key={s.id} value={s.name}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <select
                  value={repFilter}
                  onChange={(e) => {
                    setRepFilter(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="All">All Reps</option>
                  {reps.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name || r.email}
                    </option>
                  ))}
                </select>
                <select
                  value={dateFilter}
                  onChange={(e) => {
                    setDateFilter(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="All Dates">All Dates</option>
                  <option value="Today">Today</option>
                  <option value="This Week">This Week</option>
                  <option value="This Month">This Month</option>
                </select>
              </div>
            )}
          </div>

          {pageRows.length === 0 ? (
            <div className="empty-state">
              <p className="empty-label">{loadingRows ? "Loading…" : "No contacts match"}</p>
              <p className="empty-hint">{loadingRows ? "Fetching contacts." : "Try different filters."}</p>
            </div>
          ) : (
            <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 28 }}>
                    <input type="checkbox" checked={allOnPageSelected} onChange={toggleSelectAllOnPage} />
                  </th>
                  {tab === "contact" ? (
                    <>
                      <th>Name</th>
                      <th>Phone</th>
                    </>
                  ) : (
                    <>
                      <th>Lead</th>
                      <th>Contact</th>
                      <th>Phone</th>
                      <th>Status</th>
                      <th>Stage</th>
                      <th>Rep</th>
                    </>
                  )}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(l.id)}
                        onChange={() => toggleSelected(l.id)}
                      />
                    </td>
                    {tab === "contact" ? (
                      <>
                        <td>
                          <a href={`/contacts?openLead=${l.id}`} target="_blank" rel="noopener noreferrer">
                            {leadDisplayName(l)}
                          </a>
                        </td>
                        <td className="mono">{l.phone}</td>
                      </>
                    ) : (
                      <>
                        <td>
                          <a href={`/contacts?openLead=${l.id}`} target="_blank" rel="noopener noreferrer">
                            {leadDisplayName(l)}
                            {l.project_type ? ` - ${l.project_type}` : ""}
                          </a>
                        </td>
                        <td>{leadDisplayName(l)}</td>
                        <td className="mono">{l.phone}</td>
                        <td>{leadStatus(l)}</td>
                        <td>{l.stage}</td>
                        <td>{repById.get(l.assigned_to ?? "")?.name || "—"}</td>
                      </>
                    )}
                    <td className="right">
                      <button
                        type="button"
                        className="icon-btn contact-quick-action"
                        onClick={() => callLead(l)}
                        title="Call"
                        aria-label="Call"
                      >
                        📞
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}

          {total > 0 && (
            <div className="dial-queue-pagination">
              <button
                className="btn-ghost small"
                disabled={currentPage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                ← Prev
              </button>
              <span>
                {total} contact{total === 1 ? "" : "s"} · page {currentPage} of {totalPages}
                {loadingRows ? " · loading…" : ""}
              </span>
              <button
                className="btn-ghost small"
                disabled={currentPage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next →
              </button>
            </div>
          )}
        </div>

        <div className="dial-queue-side">
          <div className="dial-queue-panel">
            <div className="dial-queue-panel-title">Queue</div>
            <div className="dial-queue-count">{selected.size}</div>
            <div className="dial-queue-count-label">
              contact{selected.size === 1 ? "" : "s"} selected
            </div>
            <button
              className="btn-primary"
              style={{ width: "100%" }}
              disabled={selected.size === 0 || !canWrite || startingSession}
              onClick={startDialing}
            >
              {startingSession ? "Loading contacts…" : "Start Dialing"}
            </button>
            {phoneNumbers.length > 1 && (
              <label className="dial-queue-from">
                Calling from
                <select
                  value={callerPick}
                  onChange={(e) => pickCallerId(e.target.value)}
                >
                  {phoneNumbers.map((n) => (
                    <option key={n.id} value={n.phone_number}>
                      {(n.label ? n.label + " — " : "") + n.phone_number}
                      {n.is_default ? " (default)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <div className="dial-queue-panel">
            <div className="dial-queue-panel-title">Saved Lists</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
              <button
                className="btn-ghost small"
                disabled={selected.size === 0 || !canWrite}
                onClick={() => {
                  setSaveName("");
                  setSaveError("");
                  setShowSaveModal(true);
                }}
              >
                Save as list
              </button>
              <button
                className="btn-ghost small"
                disabled={!canWrite}
                onClick={() => csvInputRef.current?.click()}
              >
                Upload CSV
              </button>
              <input
                ref={csvInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={handleCsvFile}
                style={{ display: "none" }}
              />
            </div>
            {csvStatus && <p className="hint-note">{csvStatus}</p>}
            {dialLists.length === 0 ? (
              <p className="hint-note">No saved call lists yet. Upload a CSV or save the current selection.</p>
            ) : (
              dialLists.map((list) => (
                <div key={list.id} className="dial-queue-saved-list-row">
                  <span>
                    {list.name} <span className="hint-note">({list.lead_ids.length})</span>
                  </span>
                  <span>
                    <button className="icon-btn" title="Load" aria-label="Load list" onClick={() => loadList(list)}>
                      ↩
                    </button>
                    {canWrite && (
                      <button
                        className="icon-btn"
                        title="Delete"
                        aria-label="Delete list"
                        onClick={() => handleDeleteList(list)}
                      >
                        🗑
                      </button>
                    )}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {showSaveModal && (
        <div className="modal-backdrop" onClick={() => setShowSaveModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Save as List</h3>
              <button className="icon-btn" onClick={() => setShowSaveModal(false)} aria-label="Close">
                ✕
              </button>
            </div>
            <div className="modal-body">
              <Field label="List Name">
                <input value={saveName} onChange={(e) => setSaveName(e.target.value)} autoFocus />
              </Field>
              {saveError && <p className="error-note">{saveError}</p>}
              <div className="modal-actions">
                <div />
                <div>
                  <button className="btn-ghost" onClick={() => setShowSaveModal(false)}>
                    Cancel
                  </button>
                  <button className="btn-primary" onClick={handleSaveList} disabled={savePending}>
                    {savePending ? "Saving…" : "Save List"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {session && (
        <DialSession
          leads={session.leads}
          callInfo={session.callInfo}
          dispositions={dispositions}
          reps={reps}
          callScript={callScript}
          onClose={(completed) => {
            setSession(null);
            // A finished queue is spent: keeping it selected made the
            // next Start Dialing ring the same people all over again.
            // An early exit keeps the selection so the rep can resume.
            if (completed) setSelected(new Set());
            // Dispositions moved contacts off this filter's list --
            // refetch so the table shows the book as it now stands.
            setListRefresh((t) => t + 1);
          }}
        />
      )}
    </div>
  );
}
