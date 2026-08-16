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
  money,
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

/**
 * Targets to measure a rep against.
 *
 * Commonly quoted figures for in-home home-improvement selling, not a
 * law of nature: a $600 repair and a $250,000 ADU do not close at the
 * same rate, and every trade quotes these differently. They are here so
 * a rep has something to aim at rather than only a team median that
 * moves when a colleague has a bad month -- if the team is having a poor
 * quarter, beating the median means nothing.
 *
 * Labelled as a target on the page for exactly that reason. Worth
 * replacing with this company's own figures once there is enough history
 * to know them.
 */
const TARGET_SHOW_RATE = 0.75;
const TARGET_CLOSE_RATE = 0.3;

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
  /** Actual money recorded against the leads themselves, and how many
   *  of them carry a figure at all. */
  leadCost: number;
  leadCostKnown: number;
};

/** One line of the appointment appendix. */
type ApptRow = {
  id: string;
  date: string;
  time: string | null;
  customer: string;
  address: string | null;
  status: string;
};

/**
 * One line of the lead appendix.
 *
 * `sold` decides which column the money belongs in. An unsold lead's
 * value is somebody's estimate of what the job might be worth; a sold
 * one is the signed contract total. Showing both in one column -- which
 * the analytics panel does today -- puts $250,000 of hope beside $12,500
 * of revenue looking identical.
 */
type LeadRow = {
  id: string;
  customer: string;
  phone: string | null;
  stage: string;
  sold: boolean;
  amountCents: number;
  leadCost: number;
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
    leadCost: mine.reduce((s, l) => s + (Number(l.lead_cost) || 0), 0),
    leadCostKnown: mine.filter((l) => Number(l.lead_cost) > 0).length,
    // Denominator is the appointments with a recorded outcome, matching
    // the appointment reports. Counting the unrecorded ones as failures
    // would blame a rep for a data-entry gap.
    showRate: rate(attended.length, attended.length + noShow.length),
    closeRate: rate(signed.length, sent.length),
    avgJobCents: signed.length ? Math.round(signedCents / signed.length) : null,
  };
}

function customerOf(lead: Lead | undefined): string {
  if (!lead) return "Unknown";
  return (
    [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim() ||
    lead.company_name ||
    "Unnamed"
  );
}

/** The rep's appointments in the period, newest first. */
function apptRows(
  repId: string,
  events: Event[],
  leadById: Map<string, Lead>,
  cutoff: string | null
): ApptRow[] {
  return events
    .filter(
      (e) =>
        (e.assigned_to === repId || e.second_assigned_to === repId) &&
        (cutoff === null || e.date >= cutoff)
    )
    .map((e) => {
      const lead = e.lead_id ? leadById.get(e.lead_id) : undefined;
      return {
        id: e.id,
        date: e.date,
        time: e.time,
        customer: customerOf(lead),
        address: lead?.address ?? null,
        status: e.status,
      };
    })
    .sort((a, b) => (b.date + (b.time ?? "")).localeCompare(a.date + (a.time ?? "")));
}

/**
 * The rep's leads in the period, sold ones first and by size.
 *
 * Sold is decided by a signed contract rather than by the pipeline
 * stage: the stage moves when somebody remembers to move it, a signed
 * contract is a fact. Where one exists its total is the amount, because
 * that is what the customer actually committed to.
 */
function leadRows(
  repId: string,
  leads: Lead[],
  estimates: Estimate[],
  cutoff: string | null
): LeadRow[] {
  const signedByLead = new Map<string, number>();
  for (const e of estimates) {
    if (e.status !== "Signed" || !isSellableKind(e.kind)) continue;
    signedByLead.set(e.lead_id, (signedByLead.get(e.lead_id) ?? 0) + (e.total_cents || 0));
  }

  return leads
    .filter((l) => l.assigned_to === repId && (cutoff === null || l.created_at >= cutoff))
    .map((l) => {
      const signedCents = signedByLead.get(l.id) ?? 0;
      return {
        id: l.id,
        customer: customerOf(l),
        phone: l.phone,
        stage: l.stage,
        sold: signedCents > 0,
        // Cents throughout, so the two columns add up the same way. The
        // lead's own value is stored in whole dollars.
        amountCents: signedCents > 0 ? signedCents : Math.round((Number(l.value) || 0) * 100),
        leadCost: Number(l.lead_cost) || 0,
      };
    })
    .sort((a, b) => Number(b.sold) - Number(a.sold) || b.amountCents - a.amountCents);
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

  const leadById = new Map(((leads as Lead[]) ?? []).map((l) => [l.id, l]));
  const appointments = chosen
    ? apptRows(chosen.id, ((events as Event[]) ?? []), leadById, cutoff)
    : [];
  const leadLines = chosen
    ? leadRows(chosen.id, ((leads as Lead[]) ?? []), ((estimates as Estimate[]) ?? []), cutoff)
    : [];
  const pipelineCents = leadLines
    .filter((l) => !l.sold)
    .reduce((s, l) => s + l.amountCents, 0);
  const soldCents = leadLines.filter((l) => l.sold).reduce((s, l) => s + l.amountCents, 0);

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

            {/* Coverage beside the figure, never an average on its own.
                lead_cost is filled in on 5 of 1517 leads company-wide,
                so a cost-per-lead computed across all of them would read
                about a dollar and look like a measurement rather than an
                empty field. */}
            <h2 className="estdoc-terms-head">Lead cost</h2>
            {funnel.leadCost > 0 ? (
              <p>
                <strong>{money(funnel.leadCost)}</strong> recorded across{" "}
                {funnel.leadCostKnown} of {funnel.leads} leads.{" "}
                {funnel.signed > 0 ? (
                  <>
                    Cost per sale <strong>{money(funnel.leadCost / funnel.signed)}</strong>{" "}
                    on {funnel.signed} signed contract{funnel.signed === 1 ? "" : "s"}
                    {funnel.leadCostKnown < funnel.leads
                      ? " — based only on the leads that carry a cost, so the real figure is higher."
                      : "."}
                  </>
                ) : (
                  "No contracts signed in this period, so there is no cost per sale to show."
                )}
              </p>
            ) : (
              <p className="estdoc-muted">
                No lead cost recorded on any of this rep&apos;s leads in this period. Enter a
                cost on the lead and this becomes a cost per sale.
              </p>
            )}

            <h2 className="estdoc-terms-head">Appointments</h2>
            {appointments.length === 0 ? (
              <p className="estdoc-muted">None in this period.</p>
            ) : (
              <table className="estdoc-items estdoc-schedule-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Customer</th>
                    <th>Address</th>
                    <th>Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {appointments.map((ap) => (
                    <tr key={ap.id}>
                      <td>
                        {longDate(ap.date)}
                        {ap.time && (
                          <div className="estdoc-muted">{ap.time.slice(0, 5)}</div>
                        )}
                      </td>
                      <td>
                        <strong>{ap.customer}</strong>
                      </td>
                      <td className="estdoc-muted">{ap.address || "—"}</td>
                      {/* "New" and "Confirmed" on a past date mean nobody
                          recorded what happened, which is not the same as
                          nothing having happened. */}
                      <td>
                        {hasAppointmentResult(ap.status as EventStatus) ? (
                          ap.status
                        ) : ap.date < todayISO ? (
                          <span className="estdoc-muted">no outcome recorded</span>
                        ) : (
                          <span className="estdoc-muted">upcoming</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <h2 className="estdoc-terms-head">Leads</h2>
            {leadLines.length === 0 ? (
              <p className="estdoc-muted">None in this period.</p>
            ) : (
              <>
                <table className="estdoc-items estdoc-schedule-table">
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Phone</th>
                      <th>Stage</th>
                      <th className="estdoc-num">Pipeline</th>
                      <th className="estdoc-num">Signed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leadLines.map((l) => (
                      <tr key={l.id}>
                        <td>
                          <strong>{l.customer}</strong>
                        </td>
                        <td className="estdoc-muted">{l.phone || "—"}</td>
                        <td>{l.stage}</td>
                        <td className="estdoc-num estdoc-muted">
                          {l.sold ? "—" : l.amountCents ? moneyCents(l.amountCents) : "—"}
                        </td>
                        <td className="estdoc-num">
                          {l.sold ? <strong>{moneyCents(l.amountCents)}</strong> : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="estdoc-totals">
                  <div className="estdoc-total-row">
                    <span>Pipeline (estimated, not sold)</span>
                    <span className="mono">{moneyCents(pipelineCents)}</span>
                  </div>
                  <div className="estdoc-total-row estdoc-grand">
                    <span>Signed contracts</span>
                    <span className="mono">{moneyCents(soldCents)}</span>
                  </div>
                </div>
              </>
            )}

            {/* Where the rep stands, and the single most useful thing
                they could do next. A target beside a rate is worth more
                than the rate alone -- and the closing line is deliberately
                the nearest concrete action rather than encouragement,
                because "sell more" is not something anybody can act on. */}
            <h2 className="estdoc-terms-head">Where this sits</h2>
            <table className="estdoc-items estdoc-schedule-table">
              <thead>
                <tr>
                  <th>Measure</th>
                  <th>This rep</th>
                  <th>Team median</th>
                  <th>Target</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Show rate</strong></td>
                  <td>{pct(funnel.showRate)}</td>
                  <td className="estdoc-muted">{pct(teamShow)}</td>
                  <td>{pct(TARGET_SHOW_RATE)}</td>
                </tr>
                <tr>
                  <td><strong>Close rate</strong></td>
                  <td>{pct(funnel.closeRate)}</td>
                  <td className="estdoc-muted">{pct(teamClose)}</td>
                  <td>{pct(TARGET_CLOSE_RATE)}</td>
                </tr>
              </tbody>
            </table>

            <div className="estdoc-terms">
              <p>
                {/* One sale, priced from this rep's own average where
                    there is one, so the number means something to them
                    rather than being a company-wide figure. */}
                {funnel.sent > 0 && funnel.closeRate !== null && funnel.closeRate < TARGET_CLOSE_RATE
                  ? `Closing ${pct(TARGET_CLOSE_RATE)} of the ${funnel.sent} estimate${
                      funnel.sent === 1 ? "" : "s"
                    } sent in this period would have been ${Math.round(
                      funnel.sent * TARGET_CLOSE_RATE
                    )} contract${
                      Math.round(funnel.sent * TARGET_CLOSE_RATE) === 1 ? "" : "s"
                    } instead of ${funnel.signed}.`
                  : funnel.sent === 0
                    ? "No estimates went out in this period, so there is nothing to close yet — the first step is getting quotes in front of people."
                    : "Close rate is at or above target for this period."}
              </p>
              {funnel.noOutcome > 0 && (
                <p>
                  <strong>The quickest win here is admin, not selling.</strong>{" "}
                  {funnel.noOutcome} appointment{funnel.noOutcome === 1 ? "" : "s"} above{" "}
                  {funnel.noOutcome === 1 ? "has" : "have"} no outcome recorded. Until{" "}
                  {funnel.noOutcome === 1 ? "it is" : "they are"} filled in, this report is
                  judging {funnel.attended + funnel.noShow} appointment
                  {funnel.attended + funnel.noShow === 1 ? "" : "s"} out of {funnel.booked}.
                </p>
              )}
              <p className="estdoc-muted">
                Targets are commonly quoted figures for in-home selling, not a rule: a small
                repair and a whole-house remodel do not close at the same rate. They are a
                point to aim at, and worth replacing with this company&apos;s own once there
                is enough history to know them.
              </p>
            </div>

            <div className="estdoc-terms">
              <p>
                Show rate is attended out of the appointments with a recorded outcome. Close
                rate is contracts signed out of estimates sent. Team median is the middle
                figure across everyone holding the Sales role, so half the team sits either
                side of it.
              </p>
              <p>
                <strong>Pipeline</strong> is what somebody estimated a job might be worth and
                is not money. <strong>Signed</strong> is the total on a contract the customer
                actually signed. A lead counts as sold when it has a signed contract, not when
                its stage says Won -- the stage moves when a rep remembers to move it.
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

