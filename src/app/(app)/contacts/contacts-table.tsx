"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import {
  leadDisplayName,
  mapsUrl,
  money,
  stageColor,
  type CalendarRow,
  type Lead,
  type LeadTask,
  type LeadFile,
  type LeadNote,
  type LeadSourceRow,
  type PipelineStageRow,
  type ProjectTypeRow,
  type Profile,
} from "@/lib/data/types";
import {
  getContactDuplicateGroups,
  listContacts,
  listMatchingRecipients,
  type ContactListRow,
} from "@/lib/actions/contact-list";
import { getLeadCard } from "@/lib/actions/pipeline-board";
import type { DuplicateGroup } from "@/lib/contact-duplicates";
import { LeadForm } from "../pipeline/lead-form";
import type { LeadEstimateIndex } from "@/lib/data/lead-estimate-index";
import type { DispatcherPickerBootstrap } from "../calendar/dispatcher-picker";
import { safeInternalPath } from "@/lib/safe-path";
import { BulkEmailModal } from "@/components/bulk-email-modal";
import { CONTACT_ROW_BATCH } from "./row-batch";

/**
 * One contact row, memoized. Clicking a row re-renders the table (the
 * click opens the contact window via state), and re-reconciling every
 * row before the window paints is where the open used to spend its
 * time. Stable props mean that render now skips every row.
 */
const ContactRow = memo(function ContactRow({
  lead,
  repLabel,
  color,
  onOpen,
  selectable,
  checked,
  onToggleSelect,
}: {
  lead: ContactListRow;
  repLabel: string;
  color: string;
  onOpen: (lead: ContactListRow) => void;
  selectable: boolean;
  checked: boolean;
  onToggleSelect: (lead: ContactListRow) => void;
}) {
  return (
    <tr onClick={() => onOpen(lead)}>
      {selectable && (
        <td className="ur-select-cell" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={checked}
            onChange={() => onToggleSelect(lead)}
            aria-label={`Select ${leadDisplayName(lead)}`}
          />
        </td>
      )}
      <td>
        <div className="ur-name">{leadDisplayName(lead)}</div>
        {lead.email && <div className="ur-add-phone">{lead.email}</div>}
      </td>
      <td>
        {lead.address ? (
          <a
            href={mapsUrl(lead.address)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            {lead.address}
          </a>
        ) : (
          "—"
        )}
      </td>
      <td>{lead.phone || "—"}</td>
      <td>{lead.source || "—"}</td>
      <td>{repLabel}</td>
      <td>
        <Badge color={color}>{lead.stage}</Badge>
      </td>
      <td className="right mono">{money(lead.value)}</td>
    </tr>
  );
});

/** A selected contact carries what the bulk email needs, so a row can
 *  stay selected after it scrolls out of the fetched window. */
type Recipient = { id: string; name: string; email: string | null };

export function ContactsTable({
  initialRows,
  initialTotal,
  stats,
  reps,
  allMembers,
  stages,
  calendars,
  projectTypes,
  sources,
  canWrite,
  canDelete,
  isAdmin,
  canManageMoney,
  estimateIndex,
  dispatcherPicker,
}: {
  initialRows: ContactListRow[];
  initialTotal: number;
  stats: { totalContacts: number; withOpenLeads: number; noSetterAssigned: number };
  reps: Profile[];
  /** Whole roster, deactivated included -- name lookups only. */
  allMembers?: Profile[];
  stages: PipelineStageRow[];
  calendars: CalendarRow[];
  projectTypes: ProjectTypeRow[];
  sources: LeadSourceRow[];
  canWrite: boolean;
  canDelete: boolean;
  isAdmin: boolean;
  canManageMoney?: boolean;
  estimateIndex: LeadEstimateIndex;
  dispatcherPicker?: DispatcherPickerBootstrap;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState("");
  /** The opened contact window: the full row plus its tasks/notes/files,
   *  fetched when the row is clicked -- the page no longer carries them
   *  for every contact at once. */
  const [editing, setEditing] = useState<{
    lead: Lead;
    tasks: LeadTask[];
    notes: LeadNote[];
    files: LeadFile[];
  } | null>(null);
  const openingRef = useRef(false);
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const [selected, setSelected] = useState<Map<string, Recipient>>(new Map());
  const [showBulkEmail, setShowBulkEmail] = useState(false);
  const [selectAllNote, setSelectAllNote] = useState("");

  /**
   * The window of rows on screen, asked of the server: typing searches
   * the whole book server-side, scrolling appends the next batch. The
   * book used to arrive whole as a prop -- at 79k contacts that was the
   * slowest page in the app by far.
   */
  const [rows, setRows] = useState<ContactListRow[]>(initialRows);
  const [total, setTotal] = useState(initialTotal);
  const [loadingRows, setLoadingRows] = useState(false);
  const queryIdRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const firstQueryRef = useRef(true);

  useEffect(() => {
    // The server rendered the first batch of the empty search.
    if (firstQueryRef.current) {
      firstQueryRef.current = false;
      return;
    }
    queryIdRef.current += 1;
    const id = queryIdRef.current;
    setLoadingRows(true);
    const t = setTimeout(() => {
      listContacts({ search, offset: 0, limit: CONTACT_ROW_BATCH })
        .then((page) => {
          if (queryIdRef.current !== id) return;
          setRows(page.rows);
          setTotal(page.total);
        })
        .finally(() => {
          if (queryIdRef.current === id) setLoadingRows(false);
        });
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  const loadMore = useCallback(() => {
    if (loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    const id = queryIdRef.current;
    listContacts({ search, offset: rows.length, limit: CONTACT_ROW_BATCH })
      .then((page) => {
        if (queryIdRef.current !== id) return;
        setRows((prev) => {
          const seen = new Set(prev.map((r) => r.id));
          return [...prev, ...page.rows.filter((r) => !seen.has(r.id))];
        });
        setTotal(page.total);
      })
      .finally(() => {
        loadingMoreRef.current = false;
      });
  }, [search, rows.length]);

  /** Refresh the loaded window in place after a save/delete. */
  const refreshRows = useCallback(() => {
    queryIdRef.current += 1;
    const id = queryIdRef.current;
    listContacts({ search, offset: 0, limit: Math.max(rows.length, CONTACT_ROW_BATCH) }).then(
      (page) => {
        if (queryIdRef.current !== id) return;
        setRows(page.rows);
        setTotal(page.total);
      }
    );
  }, [search, rows.length]);

  /**
   * The duplicate banner, fetched after first paint: its grouping scans
   * the whole book server-side, and the page should never wait on it.
   */
  const [dups, setDups] = useState<{ groups: DuplicateGroup[]; totalGroups: number } | null>(null);
  useEffect(() => {
    let alive = true;
    getContactDuplicateGroups().then((d) => {
      if (alive) setDups(d);
    });
    return () => {
      alive = false;
    };
  }, []);
  const [showDuplicates, setShowDuplicates] = useState(false);

  const toggleSelected = useCallback((lead: ContactListRow) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(lead.id)) next.delete(lead.id);
      else next.set(lead.id, { id: lead.id, name: leadDisplayName(lead), email: lead.email });
      return next;
    });
    setSelectAllNote("");
  }, []);

  /** Opens a contact window from any surface: a row, a duplicate-group
   *  member, or a deep link. Fetches the card's data right then. */
  const openLead = useCallback(
    async (id: string, from?: string | null) => {
      if (openingRef.current) return;
      openingRef.current = true;
      try {
        const bundle = await getLeadCard(id);
        if (bundle) {
          if (from !== undefined) setReturnTo(safeInternalPath(from));
          setEditing(bundle);
        }
      } finally {
        openingRef.current = false;
      }
    },
    []
  );

  const openLeadId = searchParams.get("openLead");
  // A ref, not state: the guard changes inside an effect, and it exists
  // only to make each deep link open exactly once.
  const consumedOpenIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (openLeadId && openLeadId !== consumedOpenIdRef.current) {
      consumedOpenIdRef.current = openLeadId;
      // openLead captures `from` -- where to go back to once they close
      // the contact -- because the effect below strips the URL down to
      // /contacts and the page would otherwise have no memory of where
      // the user came from; closing a lead opened from Marketing
      // Analytics stranded them in Dispatch › Contacts, which looks like
      // the app navigated on its own.
      void openLead(openLeadId, searchParams.get("from"));
    } else if (!openLeadId && consumedOpenIdRef.current) {
      // Param has been stripped from the URL (below) -- clear the guard
      // so a future deep link to this same lead (e.g. searching for it
      // again) can reopen it; otherwise it stays set forever and
      // silently blocks every subsequent open of that lead until a full
      // page refresh remounts the component.
      consumedOpenIdRef.current = null;
    }
  }, [openLeadId, searchParams, openLead]);

  useEffect(() => {
    if (searchParams.get("openLead")) {
      router.replace("/contacts", { scroll: false });
    }
  }, [searchParams, router]);

  /**
   * Close the contact, returning to the page that opened it.
   *
   * Only when it was opened by a deep link carrying `from`. A contact
   * opened by clicking a row on this page has nowhere else to go, and
   * navigating away from Contacts there would be the same bug in
   * reverse.
   */
  function closeLead(changed?: boolean) {
    setEditing(null);
    if (changed) refreshRows();
    if (returnTo) {
      const target = returnTo;
      setReturnTo(null);
      router.push(target);
    }
  }

  const repById = useMemo(
    () => new Map(reps.map((r) => [r.id, r.name || "Unassigned"])),
    [reps]
  );
  function repName(id: string | null) {
    if (!id) return "Unassigned";
    return repById.get(id) || "Unassigned";
  }

  const remaining = Math.max(0, total - rows.length);

  // "Select all" means everything the search matched, not the rows
  // scrolled into view -- the ids come from the server, capped, and the
  // note says when the cap bit.
  const allLoadedSelected = rows.length > 0 && rows.every((l) => selected.has(l.id));
  async function toggleSelectAllMatching() {
    if (allLoadedSelected) {
      setSelected(new Map());
      setSelectAllNote("");
      return;
    }
    const match = await listMatchingRecipients(search);
    setSelected(new Map(match.recipients.map((r) => [r.id, r])));
    setSelectAllNote(
      match.capped
        ? `Selected the ${match.recipients.length.toLocaleString()} newest of ${match.total.toLocaleString()} matches — narrow the search to reach the rest.`
        : ""
    );
  }

  const endRef = useRef<HTMLTableRowElement | null>(null);
  useEffect(() => {
    const end = endRef.current;
    if (!end) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      // Ahead of the viewport, so the next batch is already there by the
      // time the last visible row is reached.
      { rootMargin: "800px" }
    );
    io.observe(end);
    return () => io.disconnect();
  }, [loadMore]);

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Contacts</h1>
          <p className="module-sub">Every contact across the pipeline</p>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card stat-static">
          <div className="stat-value mono">{stats.totalContacts.toLocaleString()}</div>
          <div className="stat-label">Total Contacts</div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono">{stats.withOpenLeads.toLocaleString()}</div>
          <div className="stat-label">With Open Leads</div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono">{stats.noSetterAssigned.toLocaleString()}</div>
          <div className="stat-label">No Rep Assigned</div>
        </div>
      </div>

      {dups && dups.totalGroups > 0 && (
        <div className="dup-banner">
          <span>
            ⚠ {dups.totalGroups.toLocaleString()} possible duplicate{" "}
            {dups.totalGroups === 1 ? "group" : "groups"} — contacts sharing a phone number
            or email.
          </span>
          <button className="btn-ghost small" onClick={() => setShowDuplicates((v) => !v)}>
            {showDuplicates ? "Hide" : "Review"}
          </button>
        </div>
      )}

      {showDuplicates && dups && (
        <div className="dup-panel">
          {dups.groups.map((g) => (
            <div key={g.kind + g.key} className="dup-group">
              <div className="dup-group-head">
                {g.kind === "phone" ? "📞 " : "✉ "}
                <span className="mono">{g.kind === "phone" ? g.key.replace(/(\d{3})(\d{3})(\d{4})/, "($1) $2-$3") : g.key}</span>
                {" · "}
                {g.members.length} contacts
              </div>
              {g.members.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  className="dup-member"
                  onClick={() => openLead(l.id)}
                  title="Open this contact — delete the redundant one from its card"
                >
                  <span className="ur-name">{leadDisplayName(l)}</span>
                  <span className="dup-member-meta">
                    {l.stage}
                    {Number(l.value) > 0 ? ` · ${money(l.value)}` : ""}
                    {l.email ? ` · ${l.email}` : ""}
                  </span>
                </button>
              ))}
            </div>
          ))}
          {dups.totalGroups > dups.groups.length && (
            <p className="hint-note">
              Showing the {dups.groups.length} largest of {dups.totalGroups.toLocaleString()}{" "}
              groups — clear these and reload for the next batch.
            </p>
          )}
          <p className="hint-note">
            Open each contact and keep the one with the real history — notes, appointments,
            estimates. Deleting the redundant copy happens on its card, where you can see what
            it holds first.
          </p>
        </div>
      )}

      <input
        className="ur-search"
        style={{ marginBottom: 16, maxWidth: 420 }}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search name, email, phone, or address..."
      />

      {canWrite && selected.size > 0 && (
        <div className="bulk-action-bar">
          <span>{selected.size.toLocaleString()} selected</span>
          <button type="button" className="btn-primary small" onClick={() => setShowBulkEmail(true)}>
            ✉ Email Selected
          </button>
          <button
            type="button"
            className="btn-ghost small"
            onClick={() => {
              setSelected(new Map());
              setSelectAllNote("");
            }}
          >
            Clear
          </button>
          {selectAllNote && <span className="hint-note">{selectAllNote}</span>}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="empty-state">
          <p className="empty-label">{loadingRows ? "Searching…" : "No contacts match"}</p>
          <p className="empty-hint">
            {loadingRows ? "Checking every contact." : "Try a different search term."}
          </p>
        </div>
      ) : (
        <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              {canWrite && (
                <th className="ur-select-cell">
                  <input
                    type="checkbox"
                    checked={allLoadedSelected}
                    onChange={toggleSelectAllMatching}
                    aria-label="Select all matching contacts"
                  />
                </th>
              )}
              <th>Contact</th>
              <th>Address</th>
              <th>Phone</th>
              <th>Source</th>
              <th>Assigned Rep</th>
              <th>Stage</th>
              <th className="right">Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <ContactRow
                key={l.id}
                lead={l}
                repLabel={repName(l.assigned_to)}
                color={stageColor(stages, l.stage)}
                onOpen={(lead) => void openLead(lead.id)}
                selectable={canWrite}
                checked={selected.has(l.id)}
                onToggleSelect={toggleSelected}
              />
            ))}
            {remaining > 0 && (
              <tr ref={endRef}>
                <td colSpan={canWrite ? 8 : 7} className="table-more">
                  {remaining.toLocaleString()} more
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      )}

      {showBulkEmail && (
        <BulkEmailModal
          leads={[...selected.values()]}
          onClose={() => setShowBulkEmail(false)}
          onSent={() => {
            setSelected(new Map());
            setSelectAllNote("");
          }}
        />
      )}

      {editing && (
        <LeadForm
          lead={editing.lead}
          reps={reps}
          allMembers={allMembers}
          stages={stages}
          calendars={calendars}
          projectTypes={projectTypes}
          sources={sources}
          tasks={editing.tasks}
          notes={editing.notes}
          files={editing.files}
          readOnly={!canWrite}
          canDelete={canDelete}
          isAdmin={isAdmin}
          canManageMoney={canManageMoney}
          estimateIndex={estimateIndex}
          dispatcherPicker={dispatcherPicker}
          onCancel={() => closeLead(false)}
          onSaved={() => closeLead(true)}
          onDeleted={() => closeLead(true)}
        />
      )}
    </div>
  );
}
