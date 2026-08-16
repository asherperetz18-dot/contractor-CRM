import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/data/select-all";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import {
  appointmentAttended,
  effectiveEstimateRepId,
  hasAppointmentResult,
  isSellableKind,
  moneyCents,
  type Estimate,
  type Event,
  type EventStatus,
  type Lead,
} from "@/lib/data/types";
import { PrintButton } from "@/components/print-button";
import { RepReportFilters } from "./report-filters";

export const dynamic = "force-dynamic";

type Company = {
  name: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  logo_url: string | null;
};

function longDate(value: string | null) {
  if (!value) return "—";
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
  return isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

const RANGE_LABEL: Record<string, string> = {
  "7": "Last 7 days",
  "30": "Last 30 days",
  "90": "Last 90 days",
  all: "All time",
};

/** A rate is only meaningful once there is something to divide by. */
function rate(top: number, bottom: number): number | null {
  return bottom > 0 ? top / bottom : null;
}

function pct(v: number | null) {
  return v === null ? "—" : `${Math.round(v * 100)}%`;
}

function median(values: number[]): number | null {
  const real = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (real.length === 0) return null;
  const mid = Math.floor(real.length / 2);
  return real.length % 2 ? real[mid] : (real[mid - 1] + real[mid]) / 2;
}

type Funnel = {
  leads: number;
  booked: number;
  attended: number;
  noShow: number;
  noOutcome: number;
  sent: number;
  signed: number;
  signedCents: number;
  showRate: number | null;
  closeRate: number | null;
  avgJobCents: number | null;
};

/**
 * One salesperson's funnel over a period.
 *
 * A funnel rather than a scoreboard, because totals cannot tell two
 * failing reps apart: on the Salespeople list five people read 0 / 0 /
 * $0 and look identical. One of them is not getting appointments booked
 * and another is attending them and not closing -- opposite problems,
 * opposite conversations.
 */
function buildFunnel(
  repId: string,
  leads: Lead[],
  events: Event[],
  estimates: Estimate[],
  leadRepById: Map<string, string | null>,
  cutoff: string | null,
  todayISO: string
): Funnel {
  const inRange = (d: string | null) => !!d && (cutoff === null || d >= cutoff);

  const mine = leads.filter((l) => l.assigned_to === repId && inRange(l.created_at));

  const appts = events.filter(
    (e) =>
      (e.assigned_to === repId || e.second_assigned_to === repId) && inRange(e.date)
  );
  const attended = appts.filter((e) => appointmentAttended(e.status as EventStatus));
  const noShow = appts.filter((e) => e.status === "No-show");
  // Past its date and still without a result. Counted and shown rather
  // than dropped: excluding them would quietly reward a rep who never
  // fills the outcome in over one who records every visit honestly.
  const noOutcome = appts.filter(
    (e) => e.date < todayISO && !hasAppointmentResult(e.status as EventStatus)
  );

  const repEstimates = estimates.filter(
    (e) =>
      isSellableKind(e.kind) &&
      effectiveEstimateRepId({
        status: e.status,
        estimateAssignedTo: e.assigned_to,
        leadAssignedTo: leadRepById.get(e.lead_id),
      }) === repId
  );
  const sent = repEstimates.filter(
    (e) => e.status !== "Draft" && inRange(e.sent_at ?? e.issued_at ?? e.created_at)
  );
  const signed = repEstimates.filter((e) => e.status === "Signed" && inRange(e.signed_at));
  const signedCents = signed.reduce((s, e) => s + (e.total_cents || 0), 0);

  return {
    leads: mine.length,
    booked: appts.length,
    attended: attended.length,
    noShow: noShow.length,
    noOutcome: noOutcome.length,
    sent: sent.length,
    signed: signed.length,
    signedCents,
    // Denominator is the appointments with a recorded outcome, matching
    // the appointment reports. Counting the unrecorded ones as failures
    // would blame a rep for a data-entry gap.
    showRate: rate(attended.length, attended.length + noShow.length),
    closeRate: rate(signed.length, sent.length),
    avgJobCents: signed.length ? Math.round(signedCents / signed.length) : null,
  };
}

export default async function RepReportPage({
  searchParams,
}: {
  searchParams: Promise<{ rep?: string; days?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const companyId = profile.company_id;
  const sp = await searchParams;
  const rangeKey = sp.days && RANGE_LABEL[sp.days] ? sp.days : "30";

  const supabase = await createClient();
  const [leads, members, { data: events }, { data: estimates }, { data: company }] =
    await Promise.all([
      selectAll<Lead>((f, t) =>
        supabase.from("leads").select("*").eq("company_id", companyId).range(f, t)
      ),
      getCompanyMembers(companyId),
      supabase.from("events").select("*").eq("company_id", companyId),
      supabase.from("estimates").select("*").eq("company_id", companyId),
      supabase
        .from("company_profile")
        .select("name, address, phone, email, logo_url")
        .eq("company_id", companyId)
        .maybeSingle<Company>(),
    ]);

  const now = new Date();
  const todayISO = now.toISOString().slice(0, 10);
  const cutoff =
    rangeKey === "all"
      ? null
      : new Date(now.getTime() - Number(rangeKey) * 86400000).toISOString().slice(0, 10);

  const leadRepById = new Map((leads ?? []).map((l) => [l.id, l.assigned_to]));
  const salespeople = members
    .filter((m) => m.status === "Active" && m.roles?.includes("Sales"))
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

  const funnelFor = (id: string) =>
    buildFunnel(
      id,
      (leads as Lead[]) ?? [],
      ((events as Event[]) ?? []),
      ((estimates as Estimate[]) ?? []),
      leadRepById,
      cutoff,
      todayISO
    );

  const chosen = sp.rep ? salespeople.find((r) => r.id === sp.rep) : null;
  const funnel = chosen ? funnelFor(chosen.id) : null;

  // The team's middle, so a rate has something to be judged against. A
  // number with nothing beside it is a figure, not an analysis.
  const everyone = salespeople.map((r) => funnelFor(r.id));
  const teamShow = median(
    everyone.map((f) => f.showRate).filter((v): v is number => v !== null)
  );
  const teamClose = median(
    everyone.map((f) => f.closeRate).filter((v): v is number => v !== null)
  );

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Sales rep report</h1>
          <p className="module-sub">
            One salesperson&apos;s funnel for a period &mdash; printable.
          </p>
        </div>
        <div className="toolbar-actions">
          <Link href="/marketing-analytics" className="btn-ghost">
            Back to analytics
          </Link>
          <PrintButton label="Print / Save as PDF" />
        </div>
      </div>

      <RepReportFilters
        reps={salespeople.map((r) => ({ id: r.id, name: r.name || r.email || "Unnamed" }))}
        repId={sp.rep ?? ""}
        days={rangeKey}
      />

      {!chosen || !funnel ? (
        <div className="empty-state">
          <p className="empty-label">Pick a salesperson</p>
          <p className="empty-hint">
            Choose someone above to see their funnel for this period.
          </p>
        </div>
      ) : (
        <div className="estdoc-preview-frame">
          <div className="estdoc">
            <header className="estdoc-head">
              <div className="estdoc-company">
                {company?.logo_url && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={company.logo_url} alt="" className="estdoc-logo" />
                )}
                <div>
                  <h1 className="estdoc-company-name">{company?.name || "Sales report"}</h1>
                  {company?.address && <div className="estdoc-muted">{company.address}</div>}
                  <div className="estdoc-muted">
                    {[company?.phone, company?.email].filter(Boolean).join(" · ")}
                  </div>
                </div>
              </div>
              <div className="estdoc-meta">
                <div className="estdoc-doctype">SALES REP REPORT</div>
                <div className="estdoc-muted">{RANGE_LABEL[rangeKey]}</div>
                <div className="estdoc-muted">Prepared {longDate(todayISO)}</div>
              </div>
            </header>

            <div className="estdoc-parties">
              <div>
                <div className="estdoc-label">Salesperson</div>
                <div className="estdoc-strong">{chosen.name || chosen.email}</div>
              </div>
              <div>
                <div className="estdoc-label">Signed in this period</div>
                <div className="estdoc-strong mono">{moneyCents(funnel.signedCents)}</div>
              </div>
            </div>

            <h2 className="estdoc-terms-head">The funnel</h2>
            <table className="estdoc-items estdoc-schedule-table">
              <thead>
                <tr>
                  <th>Stage</th>
                  <th className="estdoc-num">Count</th>
                  <th>Rate</th>
                  <th>Team median</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Leads assigned</strong></td>
                  <td className="estdoc-num">{funnel.leads}</td>
                  <td className="estdoc-muted">—</td>
                  <td className="estdoc-muted">—</td>
                </tr>
                <tr>
                  <td><strong>Appointments booked</strong></td>
                  <td className="estdoc-num">{funnel.booked}</td>
                  <td className="estdoc-muted">
                    {funnel.leads
                      ? `${(funnel.booked / funnel.leads).toFixed(1)} per lead`
                      : "—"}
                  </td>
                  <td className="estdoc-muted">—</td>
                </tr>
                <tr>
                  <td>
                    <strong>Attended</strong>
                    <div className="estdoc-muted">
                      {funnel.noShow} no-show{funnel.noShow === 1 ? "" : "s"}
                    </div>
                  </td>
                  <td className="estdoc-num">{funnel.attended}</td>
                  <td>{pct(funnel.showRate)} show rate</td>
                  <td className="estdoc-muted">{pct(teamShow)}</td>
                </tr>
                <tr>
                  <td><strong>Estimates sent</strong></td>
                  <td className="estdoc-num">{funnel.sent}</td>
                  <td className="estdoc-muted">—</td>
                  <td className="estdoc-muted">—</td>
                </tr>
                <tr>
                  <td><strong>Contracts signed</strong></td>
                  <td className="estdoc-num">{funnel.signed}</td>
                  <td>{pct(funnel.closeRate)} close rate</td>
                  <td className="estdoc-muted">{pct(teamClose)}</td>
                </tr>
              </tbody>
            </table>

            <div className="estdoc-totals">
              <div className="estdoc-total-row">
                <span>Average job size</span>
                <span className="mono">
                  {funnel.avgJobCents === null ? "—" : moneyCents(funnel.avgJobCents)}
                </span>
              </div>
              <div className="estdoc-total-row estdoc-grand">
                <span>Signed value</span>
                <span className="mono">{moneyCents(funnel.signedCents)}</span>
              </div>
            </div>

            {/* Stated on the document, not left out of it. The show rate
                is computed from appointments with a recorded outcome, so
                a rep with several unrecorded ones is being judged on less
                than they actually did -- and nobody reading a printed
                sheet would know unless it says so. */}
            {funnel.noOutcome > 0 && (
              <div className="estdoc-terms">
                <p>
                  <strong>
                    {funnel.noOutcome} appointment{funnel.noOutcome === 1 ? "" : "s"} in this
                    period {funnel.noOutcome === 1 ? "has" : "have"} been and gone without an
                    outcome recorded.
                  </strong>{" "}
                  The show rate above is worked out from the{" "}
                  {funnel.attended + funnel.noShow} that do have one, so it will move once
                  these are filled in.
                </p>
              </div>
            )}

            <div className="estdoc-terms">
              <p>
                Show rate is attended out of the appointments with a recorded outcome. Close
                rate is contracts signed out of estimates sent. Team median is the middle
                figure across everyone holding the Sales role, so half the team sits either
                side of it.
              </p>
              <p>
                Each stage is counted by its own date &mdash; a lead by when it arrived, an
                appointment by when it was due, a contract by when it was signed &mdash; so a
                job sold this month from a lead taken last month counts in both, where it
                actually happened.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

