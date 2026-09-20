"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  daysSince,
  effectiveEstimateRepId,
  moneyCents,
  signatureProgress,
  type Estimate,
  type EstimateSigner,
} from "@/lib/data/types";
import {
  effectiveEstimateStatus,
  matchesRepFilter,
  repOptionIds,
} from "@/lib/data/funnel-cards";
import { resolveWindow, withinWindow } from "@/lib/data/date-range";
import {
  BOARD_COLUMNS,
  boardCardStats,
  boardColumnFor,
  columnTotalCents,
  daysUntilExpiry,
  matchesBoardSearch,
  matchesScope,
  noReplyDays,
  type BoardColumnKey,
  type BoardScope,
} from "./contract-board";
import { FilterSelect } from "@/components/filter-select";
import { DateRangeFilter, type RangeState } from "@/components/date-range-filter";
import { NewEstimateDialog } from "../estimates/new-estimate-dialog";

export type ContractLead = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  address: string | null;
  /** Who holds the customer now -- the salesperson an unsigned document
   *  should name, rather than whoever happened to raise the draft. */
  assigned_to: string | null;
};

export type ContractRep = { id: string; name: string | null; email: string | null };

/** How many cards a column shows before "Show more" -- the Signed and
 *  Closed columns accumulate history forever, and the board is for
 *  what's moving now, not an archive scroll. */
const COLUMN_CARD_CAP = 30;

function shortDate(value: string | null) {
  if (!value) return "—";
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** "Aug 18, 9:12 PM" -- when a look happened, not just which day. */
function shortDateTime(value: string) {
  const d = new Date(value);
  return isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function ContractsView({
  contracts,
  signers,
  leads,
  reps,
  viewsByEstimate,
  canCreate,
}: {
  contracts: Estimate[];
  signers: EstimateSigner[];
  /** Only the leads these contracts reference, not the whole book. */
  leads: ContractLead[];
  reps: ContractRep[];
  /** Customer portal opens per document: count and most recent. */
  viewsByEstimate: Record<string, { count: number; last: string }>;
  canCreate: boolean;
}) {
  const router = useRouter();
  const [scope, setScope] = useState<BoardScope | null>(null);
  const [repFilter, setRepFilter] = useState<Set<string>>(new Set());
  const [clientFilter, setClientFilter] = useState("");
  const [range, setRange] = useState<RangeState>({ preset: "all", from: "", to: "" });
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState<Record<BoardColumnKey, number>>({
    draft: COLUMN_CARD_CAP,
    sent: COLUMN_CARD_CAP,
    viewed: COLUMN_CARD_CAP,
    signed: COLUMN_CARD_CAP,
    closed: COLUMN_CARD_CAP,
  });
  const [creating, setCreating] = useState(false);

  const now = new Date();
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const repById = new Map(reps.map((r) => [r.id, r]));
  const signersByEstimate = new Map<string, EstimateSigner[]>();
  for (const s of signers) {
    const list = signersByEstimate.get(s.estimate_id) ?? [];
    list.push(s);
    signersByEstimate.set(s.estimate_id, list);
  }

  // Who this contract's salesperson actually is -- frozen at signature,
  // following the lead's holder until then. Same rule as Estimates.
  const repIdFor = (e: Estimate) =>
    effectiveEstimateRepId({
      status: e.status,
      estimateAssignedTo: e.assigned_to,
      leadAssignedTo: leadById.get(e.lead_id)?.assigned_to,
    });

  function customerName(e: Estimate) {
    const lead = leadById.get(e.lead_id);
    if (!lead) return "Unknown customer";
    return [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim() || "Unnamed lead";
  }

  // The server already sends only kind='contract'; the guard keeps a
  // stray attached document from ever becoming a board card.
  const boardDocs = contracts.filter((e) => boardColumnFor(e) !== null);

  const win = resolveWindow(range, now);
  const filtered = boardDocs.filter((e) => {
    if (!matchesRepFilter(repIdFor(e), repFilter)) return false;
    if (clientFilter && customerName(e) !== clientFilter) return false;
    if (!withinWindow(e.created_at, win)) return false;
    const repId = repIdFor(e);
    const rep = repId ? repById.get(repId) : null;
    return matchesBoardSearch(
      {
        docNumber: e.doc_number,
        customer: customerName(e),
        title: e.title || "",
        address: e.job_address ?? leadById.get(e.lead_id)?.address ?? null,
        repName: rep?.name || rep?.email || null,
        totalCents: e.total_cents || 0,
      },
      search
    );
  });

  // The cards answer for the filtered slice, computed BEFORE the scope:
  // clicking one card must not zero out its neighbours.
  const stats = boardCardStats(filtered, now);
  const scoped = filtered.filter((e) => matchesScope(e, scope, now));

  const grouped: Record<BoardColumnKey, Estimate[]> = {
    draft: [],
    sent: [],
    viewed: [],
    signed: [],
    closed: [],
  };
  for (const e of scoped) {
    const col = boardColumnFor(e);
    if (col) grouped[col].push(e);
  }

  // Everyone with a contract on the board, plus whoever is already
  // ticked -- a tick must stay visible to be undone. Name lookups read
  // the whole roster, so historical assignees keep their names.
  const repOptions = repOptionIds(boardDocs.map(repIdFor), repFilter)
    .map((id) => {
      const rep = repById.get(id);
      return { id, label: rep?.name || rep?.email || "Unnamed" };
    })
    .sort((a, b) => a.label.localeCompare(b.label));

  const clientOptions = [...new Set(boardDocs.map(customerName))].sort((a, b) =>
    a.localeCompare(b)
  );

  const statCards: {
    key: BoardScope | "avgDays";
    className: string;
    label: string;
    value: string;
    hint: string;
  }[] = [
    {
      key: "awaiting",
      className: "est-funnel-card-sent",
      label: "Awaiting Signature",
      value: moneyCents(stats.awaiting.totalCents),
      hint: `${stats.awaiting.count} out for signature`,
    },
    {
      key: "signedMonth",
      className: "est-funnel-card-signed",
      label: `Signed — ${now.toLocaleDateString("en-US", { month: "long" })}`,
      value: moneyCents(stats.signedMonth.totalCents),
      hint: `${stats.signedMonth.count} this month`,
    },
    {
      key: "expiring",
      className: "est-funnel-card-declined",
      label: "Expiring Soon",
      value: moneyCents(stats.expiring.totalCents),
      hint: `${stats.expiring.count} expire within 7 days`,
    },
    {
      key: "avgDays",
      className: "",
      label: "Avg Days to Sign",
      value: stats.avgDays === null ? "—" : stats.avgDays.toFixed(1),
      hint: "sent to signed, last 90 days",
    },
  ];

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Contracts</h1>
          <p className="module-sub">
            {boardDocs.length === 0
              ? "No contracts yet"
              : `${boardDocs.length} contract${boardDocs.length === 1 ? "" : "s"} · ${
                  stats.awaiting.count
                } awaiting signature`}
          </p>
        </div>
        {canCreate && (
          <button className="btn-primary" onClick={() => setCreating(true)}>
            + New Contract
          </button>
        )}
      </div>

      {/* Three of the cards scope the board to the rows they counted;
          clicking the active one again clears it. Average days is a
          speed, not a set of rows, so its card is deliberately inert. */}
      <div className="est-funnel">
        {statCards.map((c) =>
          c.key === "avgDays" ? (
            <div key={c.key} className="est-funnel-card est-funnel-static">
              <span className="est-funnel-label">{c.label}</span>
              <span className="est-funnel-value">{c.value}</span>
              <span className="est-funnel-hint">{c.hint}</span>
            </div>
          ) : (
            <button
              key={c.key}
              className={
                `est-funnel-card ${c.className}` + (scope === c.key ? " est-funnel-active" : "")
              }
              aria-pressed={scope === c.key}
              onClick={() => setScope((cur) => (cur === c.key ? null : (c.key as BoardScope)))}
            >
              <span className="est-funnel-label">{c.label}</span>
              <span className="est-funnel-value">{c.value}</span>
              <span className="est-funnel-hint">{c.hint}</span>
            </button>
          )
        )}
      </div>

      <div className="list-filters">
        {(repFilter.size > 0 || repOptions.length > 1) && (
          <FilterSelect
            title="SALESPERSON"
            options={repOptions}
            selected={repFilter}
            onChange={setRepFilter}
          />
        )}
        {clientOptions.length > 1 && (
          <select
            className="ur-company-filter"
            value={clientFilter}
            onChange={(e) => setClientFilter(e.target.value)}
            aria-label="Filter by client"
          >
            <option value="">All clients</option>
            {clientOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
        <DateRangeFilter
          variant="select"
          presets={[
            { key: "all", label: "Created: Any time" },
            { key: "7", label: "Created: Last 7 days" },
            { key: "30", label: "Created: Last 30 days" },
            { key: "90", label: "Created: Last 90 days" },
          ]}
          value={range}
          onChange={setRange}
        />
        <input
          className="ur-search"
          placeholder="Search client, doc #, or address…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search contracts"
        />
        {scoped.length !== boardDocs.length && (
          <span className="list-filters-count">
            Showing {scoped.length} of {boardDocs.length}
          </span>
        )}
      </div>

      <div className="cb-board">
        {BOARD_COLUMNS.map((col) => {
          const docs = grouped[col.key];
          const visible = docs.slice(0, shown[col.key]);
          return (
            <div key={col.key} className="cb-col">
              <div className="cb-col-head">
                <div className="cb-col-head-row">
                  <span className="tick" style={{ background: col.tick }} />
                  <span>{col.label}</span>
                  <span className="count-pill">{docs.length}</span>
                </div>
                <div className="cb-col-total mono">{moneyCents(columnTotalCents(docs))}</div>
              </div>
              <div className="cb-col-body">
                {docs.length === 0 && <div className="cb-col-empty">Nothing here</div>}
                {visible.map((e) => {
                  const status = effectiveEstimateStatus(e);
                  const repId = repIdFor(e);
                  const rep = repId ? repById.get(repId) : null;
                  const sig = signatureProgress(signersByEstimate.get(e.id) ?? []);
                  const views = viewsByEstimate[e.id];
                  const expiresIn = daysUntilExpiry(e, now);
                  const silentDays = noReplyDays(e, now);
                  const awaiting = status === "Sent" || status === "Viewed";
                  return (
                    <div
                      key={e.id}
                      className={"cb-card" + (col.key === "closed" ? " cb-card-closed" : "")}
                      onClick={() => router.push(`/estimates/${e.id}`)}
                      role="link"
                      tabIndex={0}
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter") router.push(`/estimates/${e.id}`);
                      }}
                    >
                      <div className="cb-card-top">
                        <span className="mono">{e.doc_number}</span>
                        {status === "Signed" ? (
                          <span className="est-badge est-badge-signed">
                            Signed {shortDate(e.signed_at)}
                          </span>
                        ) : col.key === "closed" ? (
                          <span className={"est-badge est-badge-" + status.toLowerCase()}>
                            {status}
                          </span>
                        ) : (
                          <span className="cb-card-age">
                            {status === "Draft"
                              ? `${daysSince(e.created_at)}d`
                              : `sent ${daysSince(e.sent_at ?? e.created_at)}d`}
                          </span>
                        )}
                      </div>
                      <div className="cb-card-name">{customerName(e)}</div>
                      <div className="cb-card-title">{e.title || "Untitled"}</div>
                      <div className="cb-card-money">
                        <span className="mono">
                          {e.total_cents ? moneyCents(e.total_cents) : "—"}
                        </span>
                        <span className="cb-card-rep">{rep?.name || rep?.email || "—"}</span>
                      </div>
                      {awaiting &&
                        (sig.signed > 0 && !sig.complete ? (
                          <div className="cb-chip-row">
                            <span className="cb-chip cb-chip-amber">
                              {sig.signed}/{sig.total} signed · pending {sig.pending.join(", ")}
                            </span>
                          </div>
                        ) : null)}
                      {awaiting && (views || expiresIn !== null || silentDays !== null) && (
                        <div className="cb-chip-row">
                          {views && (
                            <span className="cb-chip cb-chip-blue">
                              Opened {views.count}× · {shortDateTime(views.last)}
                            </span>
                          )}
                          {expiresIn !== null && expiresIn <= 7 && (
                            <span className="cb-chip cb-chip-amber">
                              {expiresIn === 0 ? "Expires today" : `Expires in ${expiresIn}d`}
                            </span>
                          )}
                          {silentDays !== null && (
                            <span className="cb-chip cb-chip-amber">No reply — {silentDays}d</span>
                          )}
                        </div>
                      )}
                      {status === "Signed" && (
                        <div>
                          <a
                            className="cb-proj-link"
                            href={`/projects/${e.id}/report`}
                            onClick={(ev) => ev.stopPropagation()}
                          >
                            Open project →
                          </a>
                        </div>
                      )}
                      {col.key === "closed" && (
                        <div className="cb-card-reason">
                          {status === "Declined" && (e.declined_reason || "Customer declined")}
                          {status === "Void" && (e.void_reason || "Cancelled")}
                          {status === "Expired" && `Expired ${shortDate(e.expires_at)}`}
                        </div>
                      )}
                    </div>
                  );
                })}
                {docs.length > shown[col.key] && (
                  <button
                    className="cb-more"
                    onClick={() =>
                      setShown((cur) => ({ ...cur, [col.key]: cur[col.key] + COLUMN_CARD_CAP }))
                    }
                  >
                    Show {docs.length - shown[col.key]} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {creating && (
        <NewEstimateDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => router.push(`/estimates/${id}`)}
        />
      )}
    </div>
  );
}
