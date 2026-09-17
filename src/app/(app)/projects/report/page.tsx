import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import {
  canViewEstimates,
  moneyCents,
  projectTriageOrder,
} from "@/lib/data/types";
import { PrintButton } from "@/components/print-button";
import { buildProjectCards } from "../project-data";
import {
  chipMatches,
  dateRangeBounds,
  matchesProjectFilters,
  PROJECT_CHIPS,
  type ProjectChip,
  type ProjectDateRange,
} from "../project-filters";

export const dynamic = "force-dynamic";

type Company = {
  name: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  logo_url: string | null;
};

type ChecklistRow = {
  id: string;
  estimate_id: string;
  label: string;
  sort_order: number;
  due_date: string | null;
  assigned_to: string | null;
  completed_at: string | null;
  completed_by: string | null;
  note?: string | null;
};

const CHIP_LABEL: Record<ProjectChip, string> = {
  All: "All jobs",
  InProgress: "In progress",
  OnHold: "On hold",
  Complete: "Complete",
  Cancelled: "Cancelled",
  Bleeding: "Negative net cash",
  Owed: "Owed money",
};

const STATUS_LABEL: Record<string, string> = {
  in_progress: "In progress",
  on_hold: "On hold",
  complete: "Complete",
  cancelled: "Cancelled",
};

const RANGES: ProjectDateRange[] = ["any", "week", "month", "year", "custom"];
const RANGE_LABEL: Record<string, string> = {
  week: "signed in the last 7 days",
  month: "signed in the last 30 days",
  year: "signed in the last 12 months",
};

function longDate(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
  return isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function shortDate(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
  return isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * The Projects page on paper.
 *
 * Reached from the page's "Print report" button with the current filters
 * in the URL, so what prints is the list that was on the screen -- same
 * cards, same rollup, same filter functions. One summary block, then
 * every job in full: the figures, the facts and its steps.
 */
export default async function ProjectsReportPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    q?: string;
    client?: string;
    rep?: string;
    range?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  if (!canViewEstimates(profile)) {
    // Same rule as the Projects page itself: this sheet is money, and a
    // role that cannot see the money on screen cannot print it either.
    return (
      <div className="empty-state">
        <p className="empty-label">You don&apos;t have access to this report</p>
        <p className="empty-hint">
          The projects report shows contract totals and costs. Ask an Office or Admin user
          to switch on View Estimates for you in Admin Settings &rarr; Users &amp; Roles.
        </p>
      </div>
    );
  }

  const sp = await searchParams;
  const supabase = await createClient();
  const companyId = profile.company_id;

  const chip: ProjectChip = PROJECT_CHIPS.includes(sp.status as ProjectChip)
    ? (sp.status as ProjectChip)
    : "All";
  const range: ProjectDateRange = RANGES.includes(sp.range as ProjectDateRange)
    ? (sp.range as ProjectDateRange)
    : "any";
  const bounds = dateRangeBounds(range, sp.from ?? "", sp.to ?? "");

  const [{ cards, reps }, { data: company }, { data: checklistRows }] = await Promise.all([
    buildProjectCards(supabase, companyId),
    supabase
      .from("company_profile")
      .select("name, address, phone, email, logo_url")
      .eq("company_id", companyId)
      .maybeSingle<Company>(),
    // select * tolerantly, same as the Projects page: note arrives with
    // migration 0128 and naming it would empty every checklist till then.
    supabase
      .from("project_checklist_items")
      .select("*")
      .eq("company_id", companyId)
      .order("sort_order", { ascending: true }),
  ]);

  const listed = cards
    .filter(
      (p) =>
        chipMatches(p, chip) &&
        matchesProjectFilters(p, {
          search: sp.q ?? "",
          client: sp.client ?? "",
          rep: sp.rep ?? "",
          bounds,
        })
    )
    .sort((a, b) => projectTriageOrder(a.rollup, b.rollup));

  const memberNames = new Map(reps.map((r) => [r.id, r.name ?? ""]));
  const itemsByEstimate = new Map<string, ChecklistRow[]>();
  for (const item of (checklistRows as ChecklistRow[] | null) ?? []) {
    const list = itemsByEstimate.get(item.estimate_id) ?? [];
    list.push(item);
    itemsByEstimate.set(item.estimate_id, list);
  }

  // Totals cover exactly the jobs printed below -- unlike the screen,
  // where the cards follow only the chip. A printed sheet has no chips to
  // glance at, so its headline figures must describe its own list.
  const totals = listed.reduce(
    (acc, p) => ({
      sold: acc.sold + p.rollup.soldCents,
      collected: acc.collected + p.rollup.collectedCents,
      receivable: acc.receivable + p.rollup.receivableCents,
      cost: acc.cost + p.rollup.costCents,
      net: acc.net + p.rollup.netCashCents,
      unpaid: acc.unpaid + p.unpaidBillsCents,
    }),
    { sold: 0, collected: 0, receivable: 0, cost: 0, net: 0, unpaid: 0 }
  );

  // What the printed sheet says it covers. "Custom" alone would be
  // useless on a document somebody files -- say the actual dates.
  const scope: string[] = [CHIP_LABEL[chip]];
  if (sp.client) scope.push(`client: ${sp.client}`);
  if (sp.rep) scope.push(`rep: ${sp.rep}`);
  if (range === "custom") {
    if (sp.from && sp.to) scope.push(`signed ${longDate(sp.from)} – ${longDate(sp.to)}`);
    else if (sp.from) scope.push(`signed since ${longDate(sp.from)}`);
    else if (sp.to) scope.push(`signed up to ${longDate(sp.to)}`);
  } else if (RANGE_LABEL[range]) {
    scope.push(RANGE_LABEL[range]);
  }
  if (sp.q) scope.push(`matching “${sp.q}”`);
  const todayISO = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Projects report</h1>
          <p className="module-sub">
            Every job below in full detail &mdash; the filters came with you from the
            Projects page.
          </p>
        </div>
        <div className="toolbar-actions">
          <Link href="/projects" className="btn-ghost">
            Back to projects
          </Link>
          <PrintButton label="Print / Save as PDF" title="Projects report" />
        </div>
      </div>

      <div className="estdoc-preview-frame">
        <div className="estdoc">
          <header className="estdoc-head">
            <div className="estdoc-company">
              {company?.logo_url && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={company.logo_url} alt="" className="estdoc-logo" />
              )}
              <div>
                <h1 className="estdoc-company-name">{company?.name || "Projects report"}</h1>
                {company?.address && <div className="estdoc-muted">{company.address}</div>}
                <div className="estdoc-muted">
                  {[company?.phone, company?.email].filter(Boolean).join(" · ")}
                </div>
              </div>
            </div>
            <div className="estdoc-meta">
              <div className="estdoc-doctype">PROJECTS REPORT</div>
              <div className="estdoc-muted">{scope.join(" · ")}</div>
              <div className="estdoc-muted">Prepared {longDate(todayISO)}</div>
              <div className="estdoc-muted">Internal — includes costs</div>
            </div>
          </header>

          <div className="estdoc-parties">
            <div>
              <div className="estdoc-label">Jobs listed</div>
              <div className="estdoc-strong">{listed.length}</div>
            </div>
            <div>
              <div className="estdoc-label">Net cash across them</div>
              <div className="estdoc-strong mono">{moneyCents(totals.net)}</div>
            </div>
          </div>

          {listed.length === 0 ? (
            <p className="estdoc-muted">No jobs match those filters.</p>
          ) : (
            <>
              <h2 className="estdoc-terms-head">Totals for the jobs listed</h2>
              <div className="estdoc-totals">
                <div className="estdoc-total-row">
                  <span>Sold</span>
                  <span className="mono">{moneyCents(totals.sold)}</span>
                </div>
                <div className="estdoc-total-row">
                  <span>Collected</span>
                  <span className="mono">{moneyCents(totals.collected)}</span>
                </div>
                <div className="estdoc-total-row">
                  <span>Owed to you (billed, not yet paid)</span>
                  <span className="mono">{moneyCents(totals.receivable)}</span>
                </div>
                <div className="estdoc-total-row">
                  <span>Spent</span>
                  <span className="mono">{moneyCents(totals.cost)}</span>
                </div>
                {totals.unpaid > 0 && (
                  <div className="estdoc-total-row">
                    <span>Unpaid vendor bills (money not yet out)</span>
                    <span className="mono">{moneyCents(totals.unpaid)}</span>
                  </div>
                )}
                <div className="estdoc-total-row estdoc-grand">
                  <span>Net cash (collected − spent)</span>
                  <span className="mono">{moneyCents(totals.net)}</span>
                </div>
              </div>

              {/* Worst first, same triage order as the screen: bleeding
                  jobs, then most owed, then size. The reader's morning
                  starts at the top of page one either way. */}
              {listed.map((p) => {
                const items = itemsByEstimate.get(p.estimateId) ?? [];
                const done = items.filter((i) => i.completed_at).length;
                const overdue = items.filter(
                  (i) => i.due_date && !i.completed_at && i.due_date < todayISO
                ).length;
                return (
                  <section key={p.estimateId} className="report-job">
                    <h2 className="estdoc-terms-head">
                      {p.title || "Untitled job"} — {p.customer}
                    </h2>
                    <p className="estdoc-muted">
                      {[
                        p.docNumber,
                        p.address,
                        p.repName && `Rep: ${p.repName}`,
                        p.signedAt && `Signed ${shortDate(p.signedAt)}`,
                        p.startDate && `Starts ${shortDate(p.startDate)}`,
                        p.completionDate && `Due ${shortDate(p.completionDate)}`,
                        STATUS_LABEL[p.status],
                        p.changeOrderCount > 0 &&
                          `${p.changeOrderCount} signed change order${p.changeOrderCount === 1 ? "" : "s"}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    <div className="estdoc-totals">
                      <div className="estdoc-total-row">
                        <span>Sold</span>
                        <span className="mono">{moneyCents(p.rollup.soldCents)}</span>
                      </div>
                      <div className="estdoc-total-row">
                        <span>
                          Collected
                          {p.rollup.collectedPct !== null &&
                            ` (${p.rollup.collectedPct.toFixed(0)}% of sold)`}
                        </span>
                        <span className="mono">{moneyCents(p.rollup.collectedCents)}</span>
                      </div>
                      <div className="estdoc-total-row">
                        <span>Owed to you</span>
                        <span className="mono">{moneyCents(p.rollup.receivableCents)}</span>
                      </div>
                      <div className="estdoc-total-row">
                        <span>Spent</span>
                        <span className="mono">{moneyCents(p.rollup.costCents)}</span>
                      </div>
                      {p.unpaidBillsCents > 0 && (
                        <div className="estdoc-total-row">
                          <span>Unpaid vendor bills</span>
                          <span className="mono">{moneyCents(p.unpaidBillsCents)}</span>
                        </div>
                      )}
                      <div className="estdoc-total-row estdoc-grand">
                        <span>Net cash</span>
                        <span className="mono">{moneyCents(p.rollup.netCashCents)}</span>
                      </div>
                    </div>
                    {items.length > 0 && (
                      <>
                        <p className="estdoc-muted">
                          Steps: {done} of {items.length} done
                          {overdue > 0 &&
                            ` — ${overdue} overdue`}
                        </p>
                        <table className="estdoc-items estdoc-schedule-table">
                          <thead>
                            <tr>
                              <th>Step</th>
                              <th>Due</th>
                              <th>Assigned to</th>
                              <th>Done</th>
                            </tr>
                          </thead>
                          <tbody>
                            {items.map((i) => (
                              <tr key={i.id}>
                                <td>
                                  {i.label}
                                  {i.note && <div className="estdoc-muted">{i.note}</div>}
                                </td>
                                <td className="estdoc-muted">{shortDate(i.due_date)}</td>
                                <td className="estdoc-muted">
                                  {i.assigned_to
                                    ? memberNames.get(i.assigned_to) || "—"
                                    : "—"}
                                </td>
                                <td>
                                  {i.completed_at ? (
                                    `✓ ${shortDate(i.completed_at)}`
                                  ) : i.due_date && i.due_date < todayISO ? (
                                    <strong>overdue</strong>
                                  ) : (
                                    <span className="estdoc-muted">open</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </>
                    )}
                  </section>
                );
              })}

              <div className="estdoc-terms">
                <p>
                  <strong>Sold</strong> is the signed contract plus signed change orders.{" "}
                  <strong>Collected</strong> counts only settled payments — a pending ACH
                  transfer has not arrived. <strong>Owed to you</strong> is what has been
                  billed and not yet paid. <strong>Spent</strong> is recorded job costs;
                  unpaid vendor bills are shown beside it but not inside it, because that
                  money has not left yet. <strong>Net cash</strong> is collected less spent.
                </p>
                <p>
                  Jobs are ordered worst first: negative net cash, then the most owed, then
                  size — the same order as the Projects screen.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
