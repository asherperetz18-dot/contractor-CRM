"use client";

import React, { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { setProjectHold } from "@/lib/actions/estimates";
import { checkRainNow } from "@/lib/actions/rain-check";
import {
  mapsUrl,
  moneyCents,
  netAccrualCents,
  projectTriageOrder,
  rainPopTier,
  type ProjectRollup,
} from "@/lib/data/types";
import { jobChipClass } from "@/lib/job-chips";
import { Modal } from "@/components/ui/modal";
import { AddBillModal, jobOptionsFromProjects } from "@/components/bills/add-bill-modal";
import { JobPhotos } from "./job-photos";
import { JobReceipts } from "./job-receipts";
import { JobDocuments } from "./job-documents";
import { ProjectChecklist, type ChecklistItemRow } from "./project-checklist";
import {
  chipMatches,
  dateRangeBounds,
  matchesProjectFilters,
  projectTotals,
  type ProjectChip,
  type ProjectDateRange,
} from "./project-filters";

export type { ChecklistItemRow } from "./project-checklist";

export type ProjectStatus = "in_progress" | "on_hold" | "complete" | "cancelled";

export type ProjectCard = {
  status: ProjectStatus;
  estimateId: string;
  docNumber: string;
  title: string;
  leadId: string;
  customer: string;
  address: string | null;
  repName: string | null;
  signedAt: string | null;
  startDate: string | null;
  completionDate: string | null;
  changeOrderCount: number;
  /** The contract's child documents, for the client-view shortcuts. */
  changeOrders: { id: string; docNumber: string; title: string | null }[];
  rollup: ProjectRollup;
  /** Bills on this job that are not paid yet. Not part of Spent -- the
   *  money hasn't left -- but shown beside it so an open bill is never
   *  invisible on the job. */
  unpaidBillsCents: number;
  /** The rain-alerts cron's 48h reading for this job's site. */
  rainAlertPop: number | null;
};

// The filter semantics live in project-filters.ts, shared with the
// printable report so paper and screen can never disagree about which
// jobs a set of filters means.
type Filter = ProjectChip;
type DateRange = ProjectDateRange;

const STATUS_TAG: Record<ProjectStatus, string | null> = {
  in_progress: null, // the normal case earns no badge
  on_hold: "On hold",
  complete: "Complete",
  cancelled: "Cancelled",
};

const STATUS_LABEL: Record<ProjectStatus, string> = {
  in_progress: "In progress",
  on_hold: "On hold",
  complete: "Complete",
  cancelled: "Cancelled",
};

// Optional table columns a user can turn on -- the core money columns
// (Sold/Collected/Owed/Spent/Net cash) stay fixed since they're the
// whole point of this page, but who cares about Rep vs. Signed date vs.
// Change order count differs per person, so those are opt-in rather
// than cluttering the table for everyone by default.
type OptionalColumnKey =
  | "rep"
  | "status"
  | "signedDate"
  | "startDate"
  | "completionDate"
  | "changeOrders";
const OPTIONAL_COLUMNS: { key: OptionalColumnKey; label: string }[] = [
  { key: "rep", label: "Rep" },
  { key: "status", label: "Status" },
  { key: "signedDate", label: "Signed date" },
  { key: "startDate", label: "Start date" },
  { key: "completionDate", label: "Completion date" },
  { key: "changeOrders", label: "Change orders" },
];
const COLUMNS_STORAGE_KEY = "projects-visible-columns";

// useSyncExternalStore rather than a lazy useState initializer: reading
// localStorage during the client's first render (but not the server's)
// is exactly what a lazy initializer would do, and it reliably threw a
// "Hydration failed because the server rendered HTML didn't match the
// client" error here -- confirmed in the browser console. This hook
// exists precisely for "a browser-only value that must render the same
// on the server's first pass, then sync to the real value right after":
// getServerSnapshot supplies the SSR-safe default, and our own writes
// notify the listener set so toggling reflects immediately.
const columnListeners = new Set<() => void>();

function getVisibleColumnsSnapshot(): string {
  try {
    return window.localStorage.getItem(COLUMNS_STORAGE_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

function getServerColumnsSnapshot(): string {
  return "[]";
}

function subscribeColumns(callback: () => void): () => void {
  columnListeners.add(callback);
  return () => columnListeners.delete(callback);
}

function writeVisibleColumns(next: Set<OptionalColumnKey>) {
  try {
    window.localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify([...next]));
  } catch {
    // Best-effort persistence only -- the toggle still works this visit.
  }
  columnListeners.forEach((cb) => cb());
}

/**
 * Sold jobs, worst first.
 *
 * Sorted by money going the wrong way rather than by name or date:
 * underwater jobs, then the largest amounts owed, then everything else
 * by size. A list ordered any other way is a filing cabinet -- you have
 * to already know which job is in trouble to find out that it is.
 */
export function ProjectsView({
  projects,
  canManage,
  canAddCosts,
  canBills,
  canEditCosts,
  canUploadPhotos,
  canSeeDocChips,
  canFileDocs,
  checklistReady,
  checklistItems,
  templates,
  canEditChecklist,
  canRemoveChecklist,
  memberNames,
  canCheckRain,
  focusId,
}: {
  projects: ProjectCard[];
  canManage: boolean;
  canAddCosts: boolean;
  /** May file an unpaid bill (Bookkeeping, Office, Admin). */
  canBills: boolean;
  /** May fix or delete a paid bill after saving it (never Field). */
  canEditCosts: boolean;
  canUploadPhotos: boolean;
  /** The document shortcuts: receipts list, client-view contract and
   *  change orders. Office, Admin and Production -- never Field. */
  canSeeDocChips: boolean;
  /** Moving files between jobs: Office/Admin/Production. */
  canFileDocs: boolean;
  checklistReady: boolean;
  checklistItems: ChecklistItemRow[];
  templates: { id: string; name: string; count: number }[];
  canEditChecklist: boolean;
  canRemoveChecklist: boolean;
  memberNames: Record<string, string>;
  /** Office/Admin: may run the on-demand rain check. */
  canCheckRain: boolean;
  /** ?focus=<estimateId> deep link: show that one project until cleared. */
  focusId?: string;
}) {
  // The page opens on the jobs being worked right now; "All" is one click
  // away. Falls back to "All" when nothing is in progress, so the first
  // screen is never empty. A focus deep link starts on "All" instead --
  // the linked job may be complete or on hold, and landing on a chip
  // that hides it would make the link look broken.
  const [filter, setFilter] = useState<Filter>(() =>
    focusId ? "All" : projects.some((p) => p.status === "in_progress") ? "InProgress" : "All",
  );
  const [focus, setFocus] = useState(focusId ?? "");
  const [search, setSearch] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [repFilter, setRepFilter] = useState("");
  const [dateRange, setDateRange] = useState<DateRange>("any");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [pendingHold, setPendingHold] = useState<string | null>(null);
  // Jobs with a step past its due date and not checked off. Same
  // overdue test the checklist rows use, so the chip and the row never
  // disagree. UTC date on both server and client, so the seeded state
  // below hydrates identically.
  const overdueEstimates = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const late = new Set<string>();
    for (const item of checklistItems) {
      if (item.due_date && !item.completed_at && item.due_date < today) {
        late.add(item.estimate_id);
      }
    }
    return late;
  }, [checklistItems]);
  // Overdue jobs land with their checklist already open -- late work
  // should not hide behind a chip. Collapsing is one click and lasts
  // for the visit; still overdue tomorrow means open again tomorrow.
  const [openChecklists, setOpenChecklists] = useState<Set<string>>(
    () => new Set(overdueEstimates)
  );
  // Which job the bill modal opens on: a lead id from a row's chip,
  // "any" from the page-level button, null when closed.
  // "any" from the toolbar; a row passes its job and contract.
  const [receiptFor, setReceiptFor] = useState<
    "any" | { leadId: string; estimateId: string } | null
  >(null);
  const [photosFor, setPhotosFor] = useState<{ leadId: string; estimateId: string; label: string } | null>(null);
  const [receiptsFor, setReceiptsFor] = useState<{
    leadId: string;
    estimateId: string;
    label: string;
  } | null>(null);
  const [changeOrdersFor, setChangeOrdersFor] = useState<ProjectCard | null>(null);
  const [documentsFor, setDocumentsFor] = useState<{ leadId: string; estimateId: string; label: string } | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();
  // The on-demand rain check: same passes as the cron, this company only.
  const [rainChecking, setRainChecking] = useState(false);
  const [rainResult, setRainResult] = useState<string | null>(null);
  const visibleColumnsRaw = useSyncExternalStore(
    subscribeColumns,
    getVisibleColumnsSnapshot,
    getServerColumnsSnapshot
  );
  const visibleColumns = useMemo(() => {
    try {
      return new Set(JSON.parse(visibleColumnsRaw) as OptionalColumnKey[]);
    } catch {
      return new Set<OptionalColumnKey>();
    }
  }, [visibleColumnsRaw]);
  const [columnsOpen, setColumnsOpen] = useState(false);

  async function runRainCheck() {
    setRainChecking(true);
    setRainResult(null);
    try {
      const r = await checkRainNow();
      if (r.error) {
        setRainResult(r.error);
        return;
      }
      const sites = r.projectsChecked ?? 0;
      const appts = r.appointmentsChecked ?? 0;
      if (sites + appts === 0) {
        setRainResult("Nothing to check — no active outdoor jobs or upcoming appointments.");
      } else {
        const parts = [];
        if (sites) parts.push(`${sites} job site${sites === 1 ? "" : "s"}`);
        if (appts) parts.push(`${appts} appointment${appts === 1 ? "" : "s"}`);
        setRainResult(
          `Checked ${parts.join(" + ")} just now — highest rain chance ${
            r.worstPop === null || r.worstPop === undefined ? "unknown" : `${Math.round(r.worstPop)}%`
          }`
        );
      }
      // Badges read the columns the check just wrote; refetch so they
      // update without a manual reload.
      router.refresh();
    } finally {
      setRainChecking(false);
    }
  }

  function toggleColumn(key: OptionalColumnKey) {
    const next = new Set(visibleColumns);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    writeVisibleColumns(next);
  }

  const itemsByEstimate = useMemo(() => {
    const map = new Map<string, ChecklistItemRow[]>();
    for (const item of checklistItems) {
      const list = map.get(item.estimate_id) ?? [];
      list.push(item);
      map.set(item.estimate_id, list);
    }
    return map;
  }, [checklistItems]);

  // Cancelled jobs are dead weight: they stay reachable under their own
  // chip, but every figure and every other list on this page speaks only
  // for jobs that are still real. Folding a voided contract into Sold
  // would report money the company is never getting.
  const active = projects.filter((p) => p.status !== "cancelled");
  const cancelled = projects.filter((p) => p.status === "cancelled");

  const sorted = useMemo(
    () => [...active].sort((a, b) => projectTriageOrder(a, b)),
    [active]
  );

  // Red on the accrual figure: bills filed but unpaid count against a
  // job before the cash leaves. Same rule as the Bleeding chip.
  const bleeding = sorted.filter(
    (p) =>
      netAccrualCents({
        netCashCents: p.rollup.netCashCents,
        unpaidBillsCents: p.unpaidBillsCents,
      }) < 0
  );
  const owed = sorted.filter((p) => p.rollup.receivableCents > 0);
  const inProgress = sorted.filter((p) => p.status === "in_progress");
  const onHold = sorted.filter((p) => p.status === "on_hold");
  const complete = sorted.filter((p) => p.status === "complete");

  // Signed this calendar month, from every active job regardless of the
  // selected chip -- the "New this month" chip should read the same
  // whether you're looking at All or just Complete, so it never looks
  // like business slowed down just because you clicked a filter.
  // Cancelled contracts don't count as new business, same scope
  // "active" uses everywhere else on this page. Chip only: its stat
  // card gave way to Net accrual, the owner's call.
  const now = new Date();
  const newMonthProjects = active.filter((p) => chipMatches(p, "NewMonth", now));
  const newThisMonth = newMonthProjects.length;

  const shown =
    filter === "NewMonth"
      ? newMonthProjects
      : filter === "Bleeding"
      ? bleeding
      : filter === "Owed"
        ? owed
        : filter === "InProgress"
          ? inProgress
          : filter === "OnHold"
            ? onHold
            : filter === "Complete"
              ? complete
              : filter === "Cancelled"
                ? cancelled
                : sorted;

  // Client/rep dropdown options come from every project, not just the
  // currently selected chip -- so picking "Cancelled" doesn't also empty
  // out the rep list and make it look like that rep has nothing at all.
  const clientOptions = useMemo(
    () => [...new Set(projects.map((p) => p.customer))].sort((a, b) => a.localeCompare(b)),
    [projects]
  );
  const repOptions = useMemo(
    () =>
      [...new Set(projects.map((p) => p.repName).filter((r): r is string => !!r))].sort((a, b) =>
        a.localeCompare(b)
      ),
    [projects]
  );

  // Quick search plus the structured filters, all stacked on top of
  // whichever status chip is selected -- the chip counts above stay put
  // (they answer "how many are in this bucket"), these just narrow what's
  // visible within it.
  const q = search.trim().toLowerCase();
  const dateBounds = dateRangeBounds(dateRange, customFrom, customTo);
  const searched = shown.filter((p) =>
    matchesProjectFilters(p, {
      search,
      client: clientFilter,
      rep: repFilter,
      bounds: dateBounds,
      focusId: focus || undefined,
    })
  );

  // The printable report carries the current filters in its URL, so the
  // sheet that comes out of the printer is the list on the screen -- not
  // a fresh unfiltered one the reader has to notice is different.
  const reportParams = new URLSearchParams();
  if (filter !== "All") reportParams.set("status", filter);
  if (search.trim()) reportParams.set("q", search.trim());
  if (clientFilter) reportParams.set("client", clientFilter);
  if (repFilter) reportParams.set("rep", repFilter);
  if (dateRange !== "any") reportParams.set("range", dateRange);
  if (dateRange === "custom" && customFrom) reportParams.set("from", customFrom);
  if (dateRange === "custom" && customTo) reportParams.set("to", customTo);
  const reportQs = reportParams.toString();
  const reportHref = "/projects/report" + (reportQs ? `?${reportQs}` : "");

  // The money cards answer for exactly the list on screen: the chip
  // names the scope AND the rep/client/search/date filters narrow it,
  // same rule as Payments' cards and the estimates funnel. A company-
  // wide $976,799 above one rep's single $13,000 job reads as that
  // rep's number, and somebody quotes it as theirs.
  const totals = projectTotals(searched);

  // Costs nobody can attribute, because the customer has more than one
  // signed contract. Surfaced rather than folded into a job, so the
  // figures above are never quietly wrong.
  //
  // Counted once per customer, not once per project. Every one of a
  // customer's contracts reports the same lead-level figure, so summing
  // the column multiplied it: one $750 receipt on a customer with three
  // contracts was reported as $2,250 of unattributed cost. The totals
  // above were never affected -- they exclude these entirely -- but a
  // warning that overstates the problem is its own kind of wrong.
  const unattributed = [
    ...new Map(
      active
        .filter((p) => p.rollup.unattributedCostCents)
        .map((p) => [p.leadId, p.rollup.unattributedCostCents])
    ).values(),
  ].reduce((s, v) => s + v, 0);

  if (projects.length === 0) {
    return (
      <div className="empty-state">
        <p className="empty-label">No sold jobs yet</p>
        <p className="empty-hint">
          A project appears here the moment a contract is signed. It gathers that contract,
          its change orders, what has been collected and what the job has cost.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Projects</h1>
          <p className="page-sub">
            {active.length} sold job{active.length === 1 ? "" : "s"} · contract, collected
            and what is left after costs and commission paid
          </p>
        </div>
        {canAddCosts && (
          <button className="btn-primary" onClick={() => setReceiptFor("any")}>
            + Add bill
          </button>
        )}
      </div>

      {receiptFor && (
        <AddBillModal
          jobs={jobOptionsFromProjects(sorted)}
          initialLeadId={receiptFor === "any" ? "" : receiptFor.leadId}
          initialEstimateId={receiptFor === "any" ? undefined : receiptFor.estimateId}
          canBills={canBills}
          defaultPaid
          onClose={() => setReceiptFor(null)}
        />
      )}
      {photosFor && (
        <JobPhotos
          leadId={photosFor.leadId}
          estimateId={photosFor.estimateId}
          jobLabel={photosFor.label}
          canUpload={canUploadPhotos}
          canFile={canFileDocs}
          onClose={() => setPhotosFor(null)}
        />
      )}
      {receiptsFor && (
        <JobReceipts
          leadId={receiptsFor.leadId}
          estimateId={receiptsFor.estimateId}
          jobLabel={receiptsFor.label}
          canEdit={canEditCosts}
          jobs={jobOptionsFromProjects(sorted)}
          onClose={() => setReceiptsFor(null)}
        />
      )}
      {documentsFor && (
        <JobDocuments
          leadId={documentsFor.leadId}
          estimateId={documentsFor.estimateId}
          jobLabel={documentsFor.label}
          canFile={canFileDocs}
          onClose={() => setDocumentsFor(null)}
        />
      )}
      {changeOrdersFor && (
        <Modal
          title={`Change orders — ${changeOrdersFor.customer}`}
          onClose={() => setChangeOrdersFor(null)}
        >
          <ul className="co-link-list">
            {changeOrdersFor.changeOrders.map((co) => (
              <li key={co.id}>
                <a href={`/estimates/${co.id}/preview`} target="_blank" rel="noopener noreferrer">
                  👁 {co.docNumber}
                  {co.title ? ` · ${co.title}` : ""}
                </a>
              </li>
            ))}
          </ul>
        </Modal>
      )}

      {/* Every card answers a click with the thing that itemizes its
          number: Owed filters this page's own list, the rest open the
          page the money detail lives on. stat-card already renders the
          pointer cursor, so an inert card here read as broken. */}
      <div className="stat-grid stat-grid-6">
        <button
          type="button"
          className="stat-card"
          title="Open Estimates & Contracts"
          onClick={() => router.push("/estimates")}
        >
          <div className="stat-value mono">{moneyCents(totals.sold)}</div>
          <div className="stat-label">Sold</div>
        </button>
        <button
          type="button"
          className="stat-card"
          title="Open Payments"
          onClick={() => router.push("/payments")}
        >
          <div className="stat-value mono">{moneyCents(totals.collected)}</div>
          <div className="stat-label">Collected</div>
        </button>
        <button
          type="button"
          className="stat-card"
          title="Show the jobs owing money"
          onClick={() => setFilter("Owed")}
        >
          <div className="stat-value mono">{moneyCents(totals.receivable)}</div>
          <div className="stat-label">Owed to you</div>
        </button>
        <button
          type="button"
          className="stat-card"
          title="Open Profit & Loss"
          onClick={() => router.push("/profit-loss")}
        >
          <div className="stat-value mono">{moneyCents(totals.cost)}</div>
          <div className="stat-label">Spent</div>
          {totals.unpaid > 0 && (
            <div className="est-tax-note">+ {moneyCents(totals.unpaid)} in unpaid bills</div>
          )}
        </button>
        <button
          type="button"
          className={"stat-card" + (totals.net < 0 ? " digest-urgent" : "")}
          title="Open Profit & Loss"
          onClick={() => router.push("/profit-loss")}
        >
          <div className="stat-value mono">{moneyCents(totals.net)}</div>
          <div className="stat-label">Net cash</div>
          {totals.commission > 0 && (
            <div className="est-tax-note">
              after {moneyCents(totals.commission)} commission paid
            </div>
          )}
        </button>
        {/* In the "New this month" card's old seat, by the owner's call
            -- that count still lives on its chip below. Urgent when the
            book is underwater once committed money comes out. */}
        <button
          type="button"
          className={"stat-card" + (totals.net - totals.unpaid < 0 ? " digest-urgent" : "")}
          title="Open Profit & Loss"
          onClick={() => router.push("/profit-loss")}
        >
          <div className="stat-value mono">{moneyCents(totals.net - totals.unpaid)}</div>
          <div className="stat-label">Net accrual</div>
          {totals.unpaid > 0 && (
            <div className="est-tax-note">after {moneyCents(totals.unpaid)} unpaid bills</div>
          )}
        </button>
      </div>

      {bleeding.length > 0 && (
        <div className="dash-panel digest-urgent" style={{ marginBottom: 14 }}>
          <div className="cp-tz-head">
            <span>
              Taking in less than they have cost{" "}
              <span className="count-pill count-pill-urgent">{bleeding.length}</span>
            </span>
          </div>
          <p className="module-sub" style={{ margin: "4px 0 0" }}>
            Collected so far is behind what has been spent. That is normal early on a job and a
            problem late on one &mdash; the phase margins on the contract say which.
          </p>
        </div>
      )}

      {unattributed !== 0 && (
        <p className="hint-note">
          {moneyCents(unattributed)} of costs sit on customers with more than one signed
          contract and are not counted against any single job. File them to a phase on the
          right contract and they will land.
        </p>
      )}

      <div className="chip-row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <div className="chip-row" style={{ margin: 0 }}>
          {focus && (
            // The deep-linked job, pinned until dismissed. One chip, not a
            // filter row entry: it is the whole page's scope while it's on.
            <button
              className="chip chip-sel"
              onClick={() => setFocus("")}
              title="Back to the full list"
            >
              {(() => {
                const p = projects.find((x) => x.estimateId === focus);
                return p ? `Showing ${p.customer || p.title || p.docNumber}` : "Showing one job";
              })()}{" "}
              ✕
            </button>
          )}
          {(
            [
              ["All", `All ${active.length}`, "", active.length],
              ["InProgress", `In progress ${inProgress.length}`, "prog", inProgress.length],
              ["OnHold", `On hold ${onHold.length}`, "hold", onHold.length],
              ["Complete", `Complete ${complete.length}`, "done", complete.length],
              ["Cancelled", `Cancelled ${cancelled.length}`, "dead", cancelled.length],
              ["Bleeding", `Negative net ${bleeding.length}`, "bleed", bleeding.length],
              ["Owed", `Owed money ${owed.length}`, "owed", owed.length],
              ["NewMonth", `New this month ${newThisMonth}`, "prog", newThisMonth],
            ] as [Filter, string, string, number][]
          ).map(([f, label, tone, count]) => (
            <button
              key={f}
              // An empty chip stays uncoloured -- colour is a signal that
              // there is something behind the button, so "Cancelled 10"
              // reads louder than "On hold 0" instead of equally loud.
              className={
                "chip" +
                (tone && count > 0 ? ` chip-c-${tone}` : "") +
                (filter === f ? " chip-sel" : "")
              }
              onClick={() => setFilter(f)}
            >
              {label}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input
            className="ur-search"
            style={{ maxWidth: 200 }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search rep, client, address, or amount…"
          />
          <select
            className="ur-company-filter"
            value={clientFilter}
            onChange={(e) => setClientFilter(e.target.value)}
          >
            <option value="">All clients</option>
            {clientOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            className="ur-company-filter"
            value={repFilter}
            onChange={(e) => setRepFilter(e.target.value)}
          >
            <option value="">All reps</option>
            {repOptions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <select
            className="ur-company-filter"
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value as DateRange)}
          >
            <option value="any">Any date</option>
            <option value="week">Last 7 days</option>
            <option value="month">Last 30 days</option>
            <option value="year">Last 12 months</option>
            <option value="custom">Custom range…</option>
          </select>
          {dateRange === "custom" && (
            <>
              <input
                type="date"
                className="ur-company-filter"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                aria-label="Signed from"
              />
              <span className="est-tax-note">to</span>
              <input
                type="date"
                className="ur-company-filter"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                aria-label="Signed to"
              />
            </>
          )}
          <Link className="btn-ghost" href={reportHref} title="A printable report of the jobs currently shown, with the same filters applied">
            🖨 Print report
          </Link>
          {canCheckRain && (
            <button
              type="button"
              className="btn-ghost"
              onClick={runRainCheck}
              disabled={rainChecking}
              title="Re-check the 48h rain forecast for every active outdoor job and upcoming appointment"
            >
              {rainChecking ? "Checking rain…" : "☔ Check rain now"}
            </button>
          )}
          <div style={{ position: "relative" }}>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setColumnsOpen((v) => !v)}
            >
              Columns{visibleColumns.size > 0 ? ` (${visibleColumns.size})` : ""}
            </button>
            {columnsOpen && (
              <>
                {/* Click-away layer: any click outside the panel closes it. */}
                <div
                  style={{ position: "fixed", inset: 0, zIndex: 10 }}
                  onClick={() => setColumnsOpen(false)}
                />
                <div
                  className="dash-panel"
                  style={{
                    position: "absolute",
                    right: 0,
                    top: "100%",
                    marginTop: 4,
                    zIndex: 11,
                    minWidth: 180,
                    padding: 12,
                  }}
                >
                  <div className="est-tax-note" style={{ marginBottom: 8 }}>
                    Show extra columns
                  </div>
                  {OPTIONAL_COLUMNS.map((col) => (
                    <label
                      key={col.key}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "4px 0",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={visibleColumns.has(col.key)}
                        onChange={() => toggleColumn(col.key)}
                      />
                      {col.label}
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {rainResult && (
        <p className="est-tax-note" style={{ margin: "4px 0 0" }}>
          ☔ {rainResult}
        </p>
      )}

      {searched.length === 0 ? (
        <p className="empty-hint">
          {q || clientFilter || repFilter || dateRange !== "any"
            ? "No jobs match those filters."
            : "Nothing here — which is the good outcome."}
        </p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Job</th>
                <th>Customer</th>
                {visibleColumns.has("rep") && <th>Rep</th>}
                {visibleColumns.has("status") && <th>Status</th>}
                {visibleColumns.has("signedDate") && <th>Signed</th>}
                {visibleColumns.has("startDate") && <th>Start date</th>}
                {visibleColumns.has("completionDate") && <th>Completion date</th>}
                {visibleColumns.has("changeOrders") && <th className="right">Change orders</th>}
                <th className="right">Sold</th>
                <th className="right">Collected</th>
                <th className="right">Owed</th>
                <th className="right">Bills unpaid</th>
                <th className="right">Spent</th>
                <th className="right">Commission paid</th>
                <th className="right">Net accrual</th>
                <th className="right">Net cash</th>
              </tr>
            </thead>
            <tbody>
              {searched.map((p) => {
                const items = itemsByEstimate.get(p.estimateId) ?? [];
                const doneCount = items.filter((i) => i.completed_at).length;
                // Only a running job shows weather -- a finished or held one
                // has no crew on site, and its stored reading may be stale
                // anyway. Every reading shows, even a low one: "☔ 20%" on a
                // calm blue chip is information, the amber/red tiers alert.
                const rainPop = p.status === "in_progress" ? p.rainAlertPop : null;
                const rainTier = rainPopTier(rainPop);
                return (
                <React.Fragment key={p.estimateId}>
                <tr>
                  <td>
                    <Link href={`/estimates/${p.estimateId}`} className="ur-name">
                      {p.title || "Untitled job"}
                    </Link>
                    {rainPop !== null && rainTier && (
                      <span
                        className={"proj-tag proj-tag-rain-" + rainTier}
                        style={{ marginLeft: 6 }}
                        title="Chance of rain at this job site in the next 48 hours"
                      >
                        ☔ {Math.round(rainPop)}%
                      </span>
                    )}
                    <div className="est-tax-note">
                      {p.docNumber}
                      {p.changeOrderCount > 0 &&
                        ` · ${p.changeOrderCount} change order${p.changeOrderCount === 1 ? "" : "s"}`}
                      {p.repName && ` · ${p.repName}`}
                    </div>
                    {/* The chips, clustered by meaning so the row is
                        scanned by color: the plan, then money in (green),
                        money out (red), then the job's records. Colors
                        come from one tested map (src/lib/job-chips.ts). */}
                    <div className="proj-chip-row">
                      <span className="proj-chip-group">
                        {checklistReady && (items.length > 0 || canEditChecklist) && (
                          <button
                            type="button"
                            className={
                              jobChipClass("checklist") +
                              (items.length > 0 && doneCount === items.length
                                ? " proj-check-chip-done"
                                : "") +
                              (overdueEstimates.has(p.estimateId)
                                ? " proj-check-chip-overdue"
                                : "")
                            }
                            onClick={() =>
                              setOpenChecklists((prev) => {
                                const next = new Set(prev);
                                if (next.has(p.estimateId)) next.delete(p.estimateId);
                                else next.add(p.estimateId);
                                return next;
                              })
                            }
                          >
                            ☑ {items.length > 0 ? `${doneCount}/${items.length}` : "Checklist"}
                          </button>
                        )}
                      </span>
                      <span className="proj-chip-group">
                        {canSeeDocChips && (
                          <>
                            {/* The customer's copy, one click away -- the same
                                preview-as-customer render the portal serves. */}
                            <a
                              className={jobChipClass("contract")}
                              href={`/estimates/${p.estimateId}/preview`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              👁 Contract
                            </a>
                            {p.changeOrders.length === 1 && (
                              <a
                                className={jobChipClass("changeOrder")}
                                href={`/estimates/${p.changeOrders[0].id}/preview`}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                👁 Change order
                              </a>
                            )}
                            {p.changeOrders.length > 1 && (
                              <button
                                type="button"
                                className={jobChipClass("changeOrder")}
                                onClick={() => setChangeOrdersFor(p)}
                              >
                                👁 Change orders ({p.changeOrders.length})
                              </button>
                            )}
                          </>
                        )}
                      </span>
                      <span className="proj-chip-group">
                        {canAddCosts && p.status !== "cancelled" && (
                          /* Straight into the modal with THIS job picked --
                             the receipt is in one hand, the job is on this
                             row, nobody re-answers a question the screen
                             already knows. */
                          <button
                            type="button"
                            className={jobChipClass("addBill")}
                            onClick={() => setReceiptFor({ leadId: p.leadId, estimateId: p.estimateId })}
                          >
                            + Add bill
                          </button>
                        )}
                        {canSeeDocChips && (
                          <button
                            type="button"
                            className={jobChipClass("bills")}
                            onClick={() =>
                              setReceiptsFor({ leadId: p.leadId, estimateId: p.estimateId, label: p.customer })
                            }
                          >
                            🧾 Bills
                          </button>
                        )}
                      </span>
                      <span className="proj-chip-group">
                        {canSeeDocChips && (
                          <button
                            type="button"
                            className={jobChipClass("permits")}
                            onClick={() =>
                              setDocumentsFor({ leadId: p.leadId, estimateId: p.estimateId, label: p.customer })
                            }
                          >
                            📄 Permits &amp; files
                          </button>
                        )}
                        <button
                          type="button"
                          className={jobChipClass("photos")}
                          onClick={() => setPhotosFor({ leadId: p.leadId, estimateId: p.estimateId, label: p.customer })}
                        >
                          📷 Photos
                        </button>
                        {/* The person behind the job: the full client card on
                            Contacts (calls, texts, appointments, files), via
                            the same openLead deep link the reports and the
                            dialer use -- its back button returns here. */}
                        <Link
                          className={jobChipClass("client")}
                          href={`/contacts?openLead=${p.leadId}&from=/projects`}
                        >
                          👤 Client
                        </Link>
                        {/* One job on paper: contract and change orders,
                            payment schedule, money and steps -- with a
                            client-safe copy a click away on that page. */}
                        <Link
                          className={jobChipClass("report")}
                          href={`/projects/${p.estimateId}/report`}
                        >
                          🖨 Report
                        </Link>
                      </span>
                    </div>
                    {(STATUS_TAG[p.status] ||
                      (canManage && p.status !== "complete" && p.status !== "cancelled")) && (
                      <div className="proj-status-line">
                        {STATUS_TAG[p.status] && (
                          <span className={`proj-tag proj-tag-${p.status}`}>
                            {STATUS_TAG[p.status]}
                          </span>
                        )}
                        {canManage && p.status !== "complete" && p.status !== "cancelled" && (
                          <button
                            className="btn-ghost small"
                            disabled={pendingHold === p.estimateId}
                            onClick={() => {
                              setPendingHold(p.estimateId);
                              startTransition(async () => {
                                const res = await setProjectHold(
                                  p.estimateId,
                                  p.status !== "on_hold"
                                );
                                if (res.error) alert(res.error);
                                setPendingHold(null);
                              });
                            }}
                          >
                            {pendingHold === p.estimateId
                              ? "Saving…"
                              : p.status === "on_hold"
                                ? "Resume"
                                : "Put on hold"}
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                  <td>
                    <Link
                      className="proj-client-name"
                      href={`/contacts?openLead=${p.leadId}&from=/projects`}
                    >
                      {p.customer}
                    </Link>
                    {p.address && (
                      <div className="est-tax-note">
                        <a href={mapsUrl(p.address)} target="_blank" rel="noopener noreferrer">
                          {p.address}
                        </a>
                      </div>
                    )}
                  </td>
                  {visibleColumns.has("rep") && <td>{p.repName || "—"}</td>}
                  {visibleColumns.has("status") && <td>{STATUS_LABEL[p.status]}</td>}
                  {visibleColumns.has("signedDate") && (
                    <td>
                      {p.signedAt
                        ? new Date(p.signedAt).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })
                        : "—"}
                    </td>
                  )}
                  {visibleColumns.has("startDate") && (
                    <td>
                      {p.startDate
                        ? new Date(p.startDate).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })
                        : "—"}
                    </td>
                  )}
                  {visibleColumns.has("completionDate") && (
                    <td>
                      {p.completionDate
                        ? new Date(p.completionDate).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })
                        : "—"}
                    </td>
                  )}
                  {visibleColumns.has("changeOrders") && (
                    <td className="right mono">{p.changeOrderCount}</td>
                  )}
                  <td className="right mono">{moneyCents(p.rollup.soldCents)}</td>
                  <td className="right mono">
                    {moneyCents(p.rollup.collectedCents)}
                    {p.rollup.collectedPct !== null && (
                      <div className="est-tax-note">
                        {p.rollup.collectedPct.toFixed(0)}% of sold
                      </div>
                    )}
                  </td>
                  <td className="right mono">
                    {p.rollup.receivableCents ? moneyCents(p.rollup.receivableCents) : "—"}
                  </td>
                  <td className="right mono">
                    {/* Filed against the job, money not yet out. Its own
                        column (it used to be a note under Spent) because
                        it is the difference between the two nets. */}
                    {p.unpaidBillsCents ? moneyCents(p.unpaidBillsCents) : "—"}
                  </td>
                  <td className="right mono">
                    {p.rollup.costCents ? moneyCents(p.rollup.costCents) : "—"}
                  </td>
                  <td className="right mono">
                    {/* Commission actually paid or advanced on this job
                        (the payout ledger), already out of Net cash. Cash
                        only -- what is merely owed lives on Sales
                        Commission. Dash while nothing has been paid. */}
                    {p.rollup.commissionCents ? moneyCents(p.rollup.commissionCents) : "—"}
                  </td>
                  <td className="right mono">
                    {/* Net once the unpaid bills come out too. Red before
                        the cash leaves -- that is this column's job. No
                        unpaid projected commission in here: an estimate
                        until every expense is on the project. */}
                    {p.rollup.costCents || p.rollup.collectedCents || p.unpaidBillsCents ? (
                      (() => {
                        const accrual = netAccrualCents({
                          netCashCents: p.rollup.netCashCents,
                          unpaidBillsCents: p.unpaidBillsCents,
                        });
                        return (
                          <span className={accrual < 0 ? "stale-tag" : ""}>
                            {moneyCents(accrual)}
                          </span>
                        );
                      })()
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="right mono">
                    {/* Only coloured once something has actually been spent.
                        A job with no costs recorded is not profitable, it is
                        unmeasured, and green would say otherwise. */}
                    {p.rollup.costCents || p.rollup.collectedCents ? (
                      <span className={p.rollup.netCashCents < 0 ? "stale-tag" : ""}>
                        {moneyCents(p.rollup.netCashCents)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
                {openChecklists.has(p.estimateId) && (
                  <tr className="proj-checklist-row">
                    <td colSpan={10 + visibleColumns.size}>
                      <ProjectChecklist
                        estimateId={p.estimateId}
                        items={items}
                        templates={templates}
                        canEdit={canEditChecklist}
                        canRemove={canRemoveChecklist}
                        memberNames={memberNames}
                      />
                    </td>
                  </tr>
                )}
                </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
