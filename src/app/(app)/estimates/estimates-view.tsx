"use client";

import { clientName } from "@/lib/data/client-name";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { quickCreateDialog } from "@/lib/data/quick-create";
import {
  moneyCents,
  isSellableKind,
  signatureProgress,
} from "@/lib/data/types";
import type { EstimateListRow, EstimateListSigner } from "@/lib/data/estimate-list-rows";
import {
  effectiveEstimateStatus,
  funnelCardStats,
  inFunnelBucket,
  matchesRepFilter,
  repOptionIds,
} from "@/lib/data/funnel-cards";
import { estimateSeats } from "@/lib/data/estimate-seats";
import { mergeSavedOrder, moveBefore, type FunnelCardKey } from "@/lib/data/funnel-order";
import { saveFunnelOrder } from "@/lib/actions/funnel-order";
import { useFunnelOrder } from "./funnel-order-prefs";
import { NewEstimateDialog } from "./new-estimate-dialog";
import { NewInvoiceModal } from "@/components/invoices/new-invoice-modal";
import { FilterSelect } from "@/components/filter-select";
import { resolveWindow } from "@/lib/data/date-range";
import { calendarDay, stampedWithin } from "@/lib/company-clock";
import {
  DEFAULT_ESTIMATE_SORT,
  FOLLOW_UP_CHIPS,
  FOLLOW_UP_CHIP_LABELS,
  matchesEstimateSearch,
  followUpClock,
  matchesFollowUpChip,
  sortEstimates,
  type EstimateSort,
  type EstimateSortKey,
  type FollowUpChip,
} from "@/lib/data/estimate-list-filters";
import { estimatesCardLabel } from "@/lib/staff-words";
import { STANDARD_WORDS, type CompanyWords } from "@/lib/company-words";

export type EstimateLead = {
  id: string;
  contact_type: string | null;
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  address: string | null;
  stage: string;
  /** Who holds the customer now -- the salesperson an unsigned document
   *  should name, rather than whoever happened to raise the draft. */
  assigned_to: string | null;
  /** The rest of the lead's sales team, which an unsigned document
   *  follows too -- the salesperson filter finds a closer's jobs. */
  partner_rep_id: string | null;
  closer_id: string | null;
};

export type EstimateRep = { id: string; name: string | null; email: string | null };

// The funnel from the reference product: a draft nobody has seen, a
// proposal awaiting signature, and a signed contract are three different
// things to a contractor even though they are one row in the database.
// Change orders are a fifth card rather than folded into the first four.
// They are signed estimates too, so left alone a $1,200 extra would land
// in Contracts and turn "4 signed" into "5 signed" -- counting one job
// twice. Kept visible rather than merely filtered out, because an unsent
// change order is extra work nobody has agreed to yet, and hiding it is
// how it gets built anyway.
// Tied to the canonical card list so a card added there cannot be
// forgotten here, and vice versa -- the compiler objects. Which statuses
// and kinds each card spans lives with the counting, in
// lib/data/funnel-cards; this list is the labels.
type Bucket = FunnelCardKey;

const BUCKETS: { key: Bucket; label: string; hint: string }[] = [
  { key: "drafts", label: "Drafts", hint: "not sent yet" },
  { key: "sent", label: "Proposals", hint: "awaiting signature" },
  { key: "signed", label: "Contracts", hint: "signed" },
  { key: "declined", label: "Declined", hint: "lost or expired" },
  // Voided documents get their own card rather than being folded into
  // Declined. "The customer said no" and "we cancelled this" are
  // different events, and the second is the one somebody comes looking
  // for when they want to know what happened to a contract.
  { key: "void", label: "Voided", hint: "cancelled" },
  { key: "changes", label: "Attached", hint: "change orders & completions" },
  // The chase list Attached buries: change orders nobody has agreed to
  // yet, with the money still waiting for a signature as its total.
  { key: "co_pending", label: "Change Orders", hint: "pending" },
];

const DEFAULT_ORDER = BUCKETS.map((b) => b.key);

// Keys are presetWindow's, so "Last 30 days" here is the reports' 30 days.
const DATE_PRESETS: { key: string; label: string }[] = [
  { key: "all", label: "Any time" },
  { key: "7", label: "Last 7 days" },
  { key: "30", label: "Last 30 days" },
  { key: "month", label: "This month" },
  { key: "90", label: "Last 90 days" },
  { key: "12m", label: "Last 12 months" },
  { key: "custom", label: "Custom range…" },
];

function initials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase())
      .join("") || "?"
  );
}

function shortDate(value: string | null) {
  if (!value) return "—";
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US");
}

/** "Aug 18, 9:12 PM" -- when a look happened, not just which day. */
function shortDateTime(value: string) {
  const d = new Date(value);
  return isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function EstimatesView({
  title = "Estimates & Contracts",
  words = STANDARD_WORDS,
  estimates,
  signers,
  leads,
  reps,
  canCreate,
  viewsByEstimate,
  savedCardOrder,
  today,
  zone,
}: {
  /** In the company's own words (lib/staff-words.ts, DECISIONS #125). */
  title?: string;
  /** The company's words, for the count cards (DECISIONS #125). */
  words?: CompanyWords;
  /** Every document, but only the columns the list draws (DECISIONS #145). */
  estimates: EstimateListRow[];
  signers: EstimateListSigner[];
  /** Only the leads these documents reference, not the whole book --
   *  the New Estimate dialog reaches everyone else server-side. */
  leads: EstimateLead[];
  reps: EstimateRep[];
  canCreate: boolean;
  /** Customer portal opens per document: count and most recent. */
  viewsByEstimate: Record<string, { count: number; last: string }>;
  /** The card order saved on this person's profile. Null = never
   *  arranged there; the browser's own saved order applies instead. */
  savedCardOrder: string[] | null;
  /** The company's today, from the server: what the date filter counts from. */
  today: string;
  /** The company's zone: a document counts on the day it was made there. */
  zone: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [bucket, setBucket] = useState<Bucket>("drafts");
  const [creating, setCreating] = useState(false);
  // Quick Create's New Invoice: bill a customer an extra (a permit fee).
  const [invoicing, setInvoicing] = useState(false);

  // Quick Create's New Estimate lands here as /estimates?new=1 and the
  // dialog opens by itself. Same idiom as Contacts' openLead: the open
  // happens during render behind a consumed guard (lint forbids setState
  // inside an effect), and the effect below strips the param from the
  // URL so a refresh or a copied link doesn't reopen the dialog.
  const [consumedNew, setConsumedNew] = useState(false);
  const newParam = searchParams.get("new");
  if (newParam && !consumedNew) {
    setConsumedNew(true);
    const dialog = quickCreateDialog(newParam, canCreate);
    if (dialog === "estimate") setCreating(true);
    if (dialog === "invoice") setInvoicing(true);
  } else if (!newParam && consumedNew) {
    // Param stripped -- reset the guard so the next Quick Create click
    // (which puts ?new=1 back) opens the dialog again.
    setConsumedNew(false);
  }

  useEffect(() => {
    if (searchParams.get("new")) {
      router.replace("/estimates", { scroll: false });
    }
  }, [searchParams, router]);
  const [repFilter, setRepFilter] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [datePreset, setDatePreset] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [chips, setChips] = useState<Set<FollowUpChip>>(new Set());
  const [sort, setSort] = useState<EstimateSort>(DEFAULT_ESTIMATE_SORT);

  // Two saved orders, account first: the profile's (server-rendered, so
  // it follows the login to any device) and this browser's localStorage
  // (arrives through the store after hydration -- also the fallback for
  // anyone who arranged their cards before the profile column existed).
  // Merged against this view's own card list on the way in, so every
  // card renders even if the saved lists ever drift.
  const [accountOrder, setAccountOrder] = useState<string[] | null>(savedCardOrder);
  const [browserOrder, setBrowserOrder] = useFunnelOrder();
  const displayOrder = mergeSavedOrder(DEFAULT_ORDER, accountOrder ?? browserOrder);
  const [draggedCard, setDraggedCard] = useState<Bucket | null>(null);
  const [dragOverCard, setDragOverCard] = useState<Bucket | null>(null);

  function dropCard(onto: Bucket) {
    if (!draggedCard) return;
    const next = mergeSavedOrder(DEFAULT_ORDER, moveBefore(displayOrder, draggedCard, onto));
    // Applied locally at once, kept in the browser too (instant on the
    // next load, and still there before migration 0145 has run), and
    // saved to the profile so every device follows. A failed save is
    // deliberately quiet: the order on screen is already right, and the
    // browser copy still holds it.
    setAccountOrder(next);
    setBrowserOrder(next);
    void saveFunnelOrder(next);
  }

  // The salesperson selection survives a card switch: the person reading
  // one rep's funnel clicks from card to card, and re-ticking the rep on
  // every click was the extra work the filter was meant to save. A card
  // the rep has nothing on already reads $0.00, which is the explanation
  // an empty table needs. The status filter still clears -- its options
  // are the card's own statuses, so a carried one can flatly contradict
  // the new card (Signed inside Drafts) with nothing on screen saying so.
  // The follow-up chips clear for the same reason: each card has its own.
  // Search, dates and sort carry over -- they mean the same on every card.
  function pickBucket(next: Bucket) {
    setBucket(next);
    setStatusFilter(new Set());
    setChips(new Set());
  }

  function toggleChip(chip: FollowUpChip) {
    const next = new Set(chips);
    if (next.has(chip)) next.delete(chip);
    else next.add(chip);
    setChips(next);
  }

  function pickDatePreset(preset: string) {
    setDatePreset(preset);
    // Typed dates win over the preset in resolveWindow, so leaving
    // Custom has to drop them or the old range would stay applied.
    if (preset !== "custom") {
      setDateFrom("");
      setDateTo("");
    }
  }

  function sortBy(key: EstimateSortKey) {
    setSort((cur) =>
      cur.key === key ? { key, dir: cur.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }
    );
  }

  function clearFilters() {
    setRepFilter(new Set());
    setStatusFilter(new Set());
    setSearch("");
    pickDatePreset("all");
    setChips(new Set());
  }

  const leadById = new Map(leads.map((l) => [l.id, l]));
  const repById = new Map(reps.map((r) => [r.id, r]));
  const signersByEstimate = new Map<string, EstimateListSigner[]>();
  for (const s of signers) {
    const list = signersByEstimate.get(s.estimate_id) ?? [];
    list.push(s);
    signersByEstimate.set(s.estimate_id, list);
  }

  // Everyone on this document, its salesperson first. Not e.assigned_to:
  // that is stamped at creation and never moves, so a draft raised by
  // the dispatcher who took the call kept naming them long after the
  // lead was handed to a rep (effectiveEstimateRepId, the rule the
  // customer's copy uses). The rest are the Sales team panel's seats --
  // a closer picking their own name finds the jobs they closed for
  // somebody else.
  const seatsFor = (e: EstimateListRow) => estimateSeats(e, leadById.get(e.lead_id));
  const peopleFor = (e: EstimateListRow) => seatsFor(e).map((s) => s.id);
  const repName = (id: string) => {
    const rep = repById.get(id);
    return rep?.name || rep?.email || "Unnamed";
  };

  // Search and dates narrow every card, not just the table: "signed this
  // month" is the number a person reads off Contracts with a date picked.
  // The company's calendar, not the browser's or the server's: a
  // document made after 5pm Pacific is that day's. A date still being
  // typed is no edge rather than a broken window.
  // Noon of the company's today: the date window above counts from it,
  // and every expiry below is judged on it (DECISIONS #194). The clock
  // where the page drew put a proposal under Declined from 5pm Pacific on
  // its last day on the server's first draw, while the browser still had
  // it awaiting a signature.
  const asOf = new Date(`${today}T12:00:00`);
  const dateWindow = resolveWindow({ preset: datePreset, from: dateFrom, to: dateTo }, asOf);
  const madeInWindow = stampedWithin({ from: calendarDay(dateWindow.from), to: calendarDay(dateWindow.to) }, zone);
  const scoped = estimates.filter((e) => {
    const lead = leadById.get(e.lead_id);
    return (
      madeInWindow(e.created_at) &&
      matchesEstimateSearch(
        {
          docNumber: e.doc_number,
          customer: customerName(e),
          email: lead?.email ?? null,
          title: e.title,
          address: lead?.address ?? null,
          jobAddress: e.job_address,
        },
        search
      )
    );
  });

  // The cards answer for the same slice as the table under them: with a
  // rep ticked they hold that rep's counts and money, not the whole
  // company's -- a company-wide "$770,599 signed" above a filtered table
  // reads as the rep's number, and somebody quotes it as theirs.
  const counts = BUCKETS.map((b) => ({
    ...b,
    ...funnelCardStats(scoped, b.key, repFilter, peopleFor, asOf),
  }));

  const active = BUCKETS.find((b) => b.key === bucket)!;
  const wholeBucket = estimates.filter((e) => inFunnelBucket(e, active.key, asOf));
  const inThisBucket = scoped.filter((e) => inFunnelBucket(e, active.key, asOf));

  // Options come from what is actually in the bucket, never from the
  // full list of reps or statuses.
  //
  // The funnel cards are already a status filter, so a second one drawn
  // from every status would offer Signed inside Drafts and return an
  // empty table -- the user then has to work out that the two controls
  // disagree. Derived this way the two cannot contradict each other:
  // Drafts offers only Draft, while Attached, which spans every status,
  // offers the real spread. Same for the salesperson: people on a
  // document here, plus anyone already ticked (the selection follows the
  // reader across cards, and a tick must stay visible to be undone).
  const repOptions = repOptionIds(wholeBucket.flatMap(peopleFor), repFilter)
    .map((id) => ({ id, label: repName(id) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const statusOptions = [...new Set(wholeBucket.map((e) => effectiveEstimateStatus(e, asOf)))]
    .sort()
    .map((s) => ({ id: s, label: s }));

  const beforeChips = inThisBucket.filter(
    (e) =>
      matchesRepFilter(peopleFor(e), repFilter) &&
      (statusFilter.size === 0 || statusFilter.has(effectiveEstimateStatus(e, asOf)))
  );
  const followUp = (e: EstimateListRow) => ({ ...e, views: viewsByEstimate[e.id]?.count ?? 0 });
  const chipClock = followUpClock(today, zone);
  // Each chip's count is what ticking it would leave, given everything
  // else already on -- so a chip reading 0 is not worth the click.
  const chipOptions = FOLLOW_UP_CHIPS[bucket].map((chip) => ({
    chip,
    label: FOLLOW_UP_CHIP_LABELS[chip],
    count: beforeChips.filter((e) => matchesFollowUpChip(followUp(e), chip, chipClock)).length,
  }));
  const rows = sortEstimates(
    beforeChips.filter((e) => [...chips].every((c) => matchesFollowUpChip(followUp(e), c, chipClock))),
    sort,
    (e) => viewsByEstimate[e.id]?.count ?? 0
  );
  const filtering =
    repFilter.size > 0 ||
    statusFilter.size > 0 ||
    search.trim() !== "" ||
    dateWindow.from !== null ||
    dateWindow.to !== null ||
    chips.size > 0;

  const ariaSort = (key: EstimateSortKey) =>
    sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none";
  const sortArrow = (key: EstimateSortKey) =>
    sort.key === key ? (sort.dir === "asc" ? " ↑" : " ↓") : " ↕";

  function customerName(e: EstimateListRow) {
    const lead = leadById.get(e.lead_id);
    if (!lead) return "Unknown customer";
    return clientName(lead) || "Unnamed lead";
  }

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">{title}</h1>
          <p className="module-sub">
            {(() => {
              const contracts = estimates.filter((e) => isSellableKind(e.kind)).length;
              const changes = estimates.filter(
                (e) => !isSellableKind(e.kind) && e.kind !== "invoice"
              ).length;
              if (contracts === 0 && changes === 0) return "No estimates yet";
              return (
                `${contracts} document${contracts === 1 ? "" : "s"}` +
                (changes ? ` · ${changes} attached document${changes === 1 ? "" : "s"}` : "")
              );
            })()}
          </p>
        </div>
        {canCreate && (
          <button className="btn-primary" onClick={() => setCreating(true)}>
            + New Estimate
          </button>
        )}
      </div>

      {/* Cards in whatever order this browser dragged them into. The
          value's color travels with the card (a class per key, not
          nth-child), so Contracts stays green wherever it is parked. */}
      <div className="est-funnel">
        {displayOrder
          .map((k) => counts.find((c) => c.key === k)!)
          .map((b) => (
            <button
              key={b.key}
              className={
                `est-funnel-card est-funnel-card-${b.key}` +
                (bucket === b.key ? " est-funnel-active" : "") +
                (draggedCard === b.key ? " est-funnel-dragging" : "") +
                (dragOverCard === b.key && draggedCard !== b.key ? " est-funnel-dragover" : "")
              }
              onClick={() => pickBucket(b.key)}
              aria-pressed={bucket === b.key}
              draggable
              title="Drag to reorder"
              onDragStart={() => setDraggedCard(b.key)}
              onDragOver={(ev) => {
                ev.preventDefault();
                setDragOverCard(b.key);
              }}
              onDragLeave={() => setDragOverCard((cur) => (cur === b.key ? null : cur))}
              onDrop={(ev) => {
                ev.preventDefault();
                dropCard(b.key);
              }}
              onDragEnd={() => {
                setDraggedCard(null);
                setDragOverCard(null);
              }}
            >
              <span className="est-funnel-label">{estimatesCardLabel(b.key, b.label, words)}</span>
              <span className="est-funnel-value">{moneyCents(b.totalCents)}</span>
              <span className="est-funnel-hint">
                {b.count} {b.hint}
              </span>
            </button>
          ))}
      </div>

      {/* Search and dates are always offered -- they find a document on
          any card. The dropdowns only appear when there is something to
          choose between: a dropdown holding one option filters nothing,
          and on the Drafts card -- where every row is a draft by
          definition -- a Status filter is exactly that. The one
          exception: while a rep is ticked, the salesperson dropdown
          always renders, because it is the only place the carried filter
          can be seen and undone. */}
      <div className="list-filters est-list-filters">
        {(repFilter.size > 0 || repOptions.length > 1) && (
          <FilterSelect
            title="SALESPERSON"
            options={repOptions}
            selected={repFilter}
            onChange={setRepFilter}
          />
        )}
        {statusOptions.length > 1 && (
          <FilterSelect
            title="STATUS"
            options={statusOptions}
            selected={statusFilter}
            onChange={setStatusFilter}
          />
        )}
        <input
          type="search"
          className="ur-search est-list-search"
          value={search}
          onChange={(ev) => setSearch(ev.target.value)}
          placeholder="Search customer, EST #, title or address…"
          aria-label="Search estimates"
        />
        <select
          className="ur-company-filter"
          value={datePreset}
          onChange={(ev) => pickDatePreset(ev.target.value)}
          aria-label="Date created"
        >
          {DATE_PRESETS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
        {datePreset === "custom" && (
          <span className="est-list-dates">
            <input
              type="date"
              className="ur-company-filter"
              value={dateFrom}
              max={today}
              onChange={(ev) => setDateFrom(ev.target.value)}
              aria-label="Created from"
            />
            <span className="est-tax-note">to</span>
            <input
              type="date"
              className="ur-company-filter"
              value={dateTo}
              max={today}
              onChange={(ev) => setDateTo(ev.target.value)}
              aria-label="Created to"
            />
          </span>
        )}
        {chipOptions.length > 0 && (
          <span className="est-list-chips" role="group" aria-label="Follow-up">
            {chipOptions.map((c) => (
              <button
                key={c.chip}
                type="button"
                className={"chip" + (chips.has(c.chip) ? " chip-active" : "")}
                aria-pressed={chips.has(c.chip)}
                onClick={() => toggleChip(c.chip)}
              >
                {c.label} <span className="count-pill">{c.count}</span>
              </button>
            ))}
          </span>
        )}
        {filtering && (
          <span className="est-list-meta">
            <span className="list-filters-count">
              Showing {rows.length} of {wholeBucket.length}
            </span>
            <button type="button" className="btn-ghost small" onClick={clearFilters}>
              Clear all
            </button>
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        filtering && wholeBucket.length > 0 ? (
          <div className="empty-state">
            <p className="empty-label">No {active.label.toLowerCase()} match these filters</p>
            <p className="empty-hint">
              <button type="button" className="btn-ghost small" onClick={clearFilters}>
                Clear all filters
              </button>
            </p>
          </div>
        ) : (
          <div className="empty-state">
            <p className="empty-label">Nothing in {active.label.toLowerCase()}</p>
            <p className="empty-hint">
              {bucket === "drafts" && canCreate
                ? "Start one with + New Estimate and link it to a lead."
                : "Documents move here as they progress."}
            </p>
          </div>
        )
      ) : (
        // Its own scroller: nine columns run past a tablet's width, and
        // bare tables only start scrolling themselves on phones.
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Doc #</th>
                <th>Customer</th>
                <th>Title</th>
                <th></th>
                <th>Salesperson</th>
                <th aria-sort={ariaSort("date")}>
                  <button type="button" className="th-sort" onClick={() => sortBy("date")}>
                    Date{sortArrow("date")}
                  </button>
                </th>
                <th>Status</th>
                <th aria-sort={ariaSort("views")}>
                  <button type="button" className="th-sort" onClick={() => sortBy("views")}>
                    Views{sortArrow("views")}
                  </button>
                </th>
                <th className="right" aria-sort={ariaSort("total")}>
                  <button type="button" className="th-sort" onClick={() => sortBy("total")}>
                    Total{sortArrow("total")}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const lead = leadById.get(e.lead_id);
                const [salesperson, ...team] = seatsFor(e);
                const sig = signatureProgress(signersByEstimate.get(e.id) ?? []);
                const status = effectiveEstimateStatus(e, asOf);
                // Nobody owes a signature on a document that is over.
                // Expired belongs here too: the price lapsed, so a partial
                // signature on it is history rather than an outstanding ask.
                const settled =
                  status === "Void" || status === "Declined" || status === "Expired";
                return (
                  <tr
                    key={e.id}
                    className="est-row"
                    onClick={() => router.push(`/estimates/${e.id}`)}
                    role="link"
                    tabIndex={0}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter") router.push(`/estimates/${e.id}`);
                    }}
                  >
                    <td className="mono">{e.doc_number}</td>
                    <td>
                      <div className="ur-name-cell">
                        <span className="ur-avatar">{initials(customerName(e))}</span>
                        <div>
                          <div className="ur-name">{customerName(e)}</div>
                          <div className="ur-add-phone">{lead?.email || "—"}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="ur-name">{e.title || "Untitled"}</div>
                      <div className="ur-add-phone">{lead?.address || "—"}</div>
                    </td>
                    {/* Straight to the document the customer sees -- the
                        same component the portal renders -- without going
                        through the builder. A staff preview, so it never
                        counts as a customer view. stopPropagation because
                        the whole row is already a link to the builder. */}
                    <td>
                      <button
                        className="btn-ghost small est-client-view"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          router.push(`/estimates/${e.id}/preview`);
                        }}
                        title="Open this document exactly as the customer sees it"
                      >
                        👁 Client view
                      </button>
                    </td>
                    {/* The rest of the team under the salesperson, so a
                        row a closer's filter found says why it is here. */}
                    <td>
                      <div>{salesperson ? repName(salesperson.id) : "—"}</div>
                      {team.map((s) => (
                        <div key={s.id} className="ur-add-phone">
                          {s.role}: {repName(s.id)}
                        </div>
                      ))}
                    </td>
                    <td>
                      <div>{shortDate(e.created_at)}</div>
                      {e.expires_at && status !== "Signed" && (
                        <div className="ur-add-phone">Exp: {shortDate(e.expires_at)}</div>
                      )}
                    </td>
                    {/* Signature progress is shown INSTEAD of the status,
                        so a document that is finished with has to say so
                        first. A voided change order carrying one of two
                        signatures was reading "1/2 Signed — Pending: <the
                        customer>": it hid that the document was cancelled,
                        and named a real person as still owing a signature
                        on it. Somebody chases that. */}
                    <td>
                      <span className={"est-badge est-badge-" + status.toLowerCase()}>
                        {!settled && sig.total > 0 && sig.signed > 0 && !sig.complete
                          ? `${sig.signed}/${sig.total} Signed`
                          : status}
                      </span>
                      {!settled && sig.pending.length > 0 && sig.signed > 0 && (
                        <div className="ur-add-phone">Pending: {sig.pending.join(", ")}</div>
                      )}
                    </td>
                    {/* Customer attention, at a glance. Five opens in two
                        days is a customer deciding; none since Sent is a
                        phone call waiting to happen. */}
                    <td>
                      {viewsByEstimate[e.id] ? (
                        <>
                          <div>{viewsByEstimate[e.id].count}×</div>
                          <div className="ur-add-phone">
                            {shortDateTime(viewsByEstimate[e.id].last)}
                          </div>
                        </>
                      ) : (
                        <span className="estdoc-muted">—</span>
                      )}
                    </td>
                    <td className="right mono">
                      {e.total_cents ? moneyCents(e.total_cents) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {invoicing && (
        <NewInvoiceModal
          onClose={() => setInvoicing(false)}
          onIssued={({ id }) => router.push(`/estimates/${id}`)}
        />
      )}

      {creating && (
        <NewEstimateDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => router.push(`/estimates/${id}`)}
        />
      )}

      {/* canDelete is read on the document itself, where Delete and Void
          live. This list had `{!canDelete && null}` -- a line that renders
          nothing either way, and the only thing standing where a delete
          control appeared to be. */}
    </div>
  );
}
