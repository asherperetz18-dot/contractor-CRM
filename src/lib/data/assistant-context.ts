import {
  leadDisplayName,
  money,
  moneyCents,
  effectiveEstimateRepId,
  type ContactType,
  type Estimate,
} from "./types.ts";
import { funnelCardStats, effectiveEstimateStatus } from "./funnel-cards.ts";

/**
 * Everything the AI assistant is allowed to read, rendered as one plain
 * text block. Pure on purpose: the route fetches (under the caller's own
 * RLS session), this file decides what a given viewer's context says --
 * so the two rules that matter are testable without a database:
 *
 * - Sections follow the same access checks as the pages they mirror.
 *   Estimate money renders only with canViewEstimates (the Estimates
 *   page's gate); receivables only with canViewFinancials (the Payments
 *   page's gate); a viewer without estimate access gets project rows
 *   with no dollar figure on them, matching the crew view's promise.
 * - Every summary is computed over ALL rows, never over the capped
 *   detail list. The detail lines are a sample; the totals are the
 *   truth. (The lead Summary learned this the hard way -- see the
 *   selectAll note in the route.)
 */

// Detail-line caps. Summaries always span every row regardless.
export const MAX_LEADS_IN_CONTEXT = 400;
export const MAX_ESTIMATES_IN_CONTEXT = 150;
export const MAX_PROJECTS_IN_CONTEXT = 100;
export const MAX_CALLS_IN_CONTEXT = 100;
export const MAX_COLLECT_LINES = 25;
export const CALL_WINDOW_DAYS = 30;

export type AssistantAccess = {
  canViewEstimates: boolean;
  canViewFinancials: boolean;
};

export type AssistantLead = {
  id: string;
  contact_type: ContactType | null;
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  source: string | null;
  project_type: string | null;
  stage: string;
  value: number | string | null;
  assigned_to: string | null;
  date_received: string | null;
  created_at: string;
};

export type AssistantEvent = {
  id: string;
  title: string | null;
  date: string;
  time: string | null;
  end_time: string | null;
  event_type: string;
  status: string;
  assigned_to: string | null;
  lead_id: string | null;
};

export type AssistantTask = {
  id: string;
  lead_id: string;
  title: string;
  due_date: string;
  completed_at: string | null;
  assigned_to: string | null;
};

export type AssistantEstimate = Pick<
  Estimate,
  | "id"
  | "lead_id"
  | "doc_number"
  | "title"
  | "status"
  | "kind"
  | "total_cents"
  | "expires_at"
  | "signed_at"
  | "created_at"
  | "assigned_to"
  | "parent_estimate_id"
>;

/** A project card flattened to what a context line needs -- derived in
 *  the route from buildProjectCards, so these figures are the Projects
 *  page's own. */
export type AssistantProject = {
  docNumber: string;
  title: string;
  customer: string;
  address: string | null;
  status: "in_progress" | "on_hold" | "complete" | "cancelled";
  repName: string | null;
  signedAt: string | null;
  startDate: string | null;
  completionDate: string | null;
  soldCents: number;
  collectedCents: number;
  receivableCents: number;
  costCents: number;
  netCashCents: number;
  unpaidBillsCents: number;
};

export type AssistantCall = {
  created_at: string;
  direction: "outbound" | "inbound";
  disposition: string;
  status: string;
  duration_seconds: number;
  rep_id: string | null;
  lead_id: string | null;
};

export type AssistantContextInput = {
  companyName: string;
  todayISO: string;
  stages: string[];
  team: { id: string; name: string }[];
  access: AssistantAccess;
  /** The capped detail roster (query-limited to MAX_LEADS_IN_CONTEXT). */
  leads: AssistantLead[];
  /** Narrow columns for EVERY lead -- the accurate totals. */
  leadTotals: { stage: string; value: number }[];
  events: AssistantEvent[];
  tasks: AssistantTask[];
  /** Every document, like the Estimates page fetches. */
  estimates: AssistantEstimate[];
  /** Every project card. */
  projects: AssistantProject[];
  /** Every call inside the window. */
  calls: AssistantCall[];
  callWindowDays: number;
  /** Names for lead ids referenced by documents/calls but too old for
   *  the detail roster -- a signed job's customer must never read as
   *  "Unnamed" just because the lead is years old. */
  extraLeadNames: Map<string, string>;
};

export function formatCallDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`;
}

const ESTIMATE_KIND_LABEL: Record<string, string> = {
  contract: "contract",
  change_order: "change order",
  completion: "completion certificate",
};

const PROJECT_STATUS_LABEL: Record<AssistantProject["status"], string> = {
  in_progress: "in progress",
  on_hold: "on hold",
  complete: "complete",
  cancelled: "cancelled",
};

// Context slots go to the jobs someone is asking about: running work
// first, finished work as history, cancelled last.
const PROJECT_STATUS_RANK: Record<AssistantProject["status"], number> = {
  in_progress: 0,
  on_hold: 1,
  complete: 2,
  cancelled: 3,
};

export function buildAssistantContext(input: AssistantContextInput): string {
  const repName = new Map(input.team.map((m) => [m.id, m.name]));
  const rep = (id: string | null | undefined) => (id ? repName.get(id) || "Unassigned" : "Unassigned");

  const leadById = new Map(input.leads.map((l) => [l.id, l]));

  const leadName = (id: string | null | undefined): string => {
    if (!id) return "—";
    const lead = leadById.get(id);
    if (lead) return leadDisplayName({ ...lead, contact_type: lead.contact_type ?? "Individual" });
    return input.extraLeadNames.get(id) || "—";
  };

  // ── Leads (unchanged behavior: capped roster, whole-book summary) ──
  const openTotals = input.leadTotals.filter((l) => l.stage !== "Won" && l.stage !== "Lost");
  const openPipelineValue = openTotals.reduce((sum, l) => sum + (Number(l.value) || 0), 0);

  const leadLines = input.leads.map((l) => {
    // The id is included so a proposed change can name exact records.
    // Every id is re-validated against this company before anything is
    // applied.
    return `- id: ${l.id} | ${leadName(l.id)} | phone: ${l.phone || "—"} | email: ${l.email || "—"} | stage: ${l.stage} | value: ${money(
      Number(l.value) || 0
    )} | source: ${l.source || "—"} | project: ${l.project_type || "—"} | rep: ${rep(l.assigned_to)} | received: ${l.date_received || "—"}`;
  });

  const eventLines = input.events.map((ev) => {
    const contact = ev.lead_id && leadName(ev.lead_id) !== "—" ? ` | contact: ${leadName(ev.lead_id)}` : "";
    return `- ${ev.date} ${ev.time || ""}${ev.end_time ? `-${ev.end_time}` : ""} | ${ev.title || ev.event_type} | ${ev.event_type} | status: ${ev.status} | rep: ${rep(ev.assigned_to)}${contact}`;
  });

  const taskLines = input.tasks.map((t) => {
    const overdue = t.due_date < input.todayISO ? " (OVERDUE)" : "";
    const contact = leadName(t.lead_id) !== "—" ? ` | contact: ${leadName(t.lead_id)}` : "";
    return `- Due ${t.due_date}${overdue} | ${t.title} | rep: ${rep(t.assigned_to)}${contact}`;
  });

  const sections: string[] = [
    [
      `Company: ${input.companyName}`,
      `Today's date: ${input.todayISO}`,
      `Pipeline stages (in order): ${input.stages.join(", ") || "none configured"}`,
    ].join("\n"),
    [
      `TEAM (use these ids when proposing an assignment):`,
      input.team.length ? input.team.map((m) => `- id: ${m.id} | ${m.name}`).join("\n") : "(none)",
    ].join("\n"),
    `Summary (accurate company-wide totals -- use these for any count/value question): ${openTotals.length} open leads worth ${money(openPipelineValue)} total, out of ${input.leadTotals.length} leads overall.`,
    [
      `LEADS -- detail roster, most recent ${input.leads.length} of ${input.leadTotals.length} total (older leads are omitted here; rely on the Summary above for totals, not a count of this list):`,
      leadLines.length ? leadLines.join("\n") : "(none)",
    ].join("\n"),
    [
      `UPCOMING/RECENT APPOINTMENTS (yesterday through next 14 days):`,
      eventLines.length ? eventLines.join("\n") : "(none)",
    ].join("\n"),
    [`OPEN TASKS (due within 30 days or overdue):`, taskLines.length ? taskLines.join("\n") : "(none)"].join("\n"),
  ];

  // ── Estimates & contracts: the Estimates page's own funnel rules ──
  if (input.access.canViewEstimates) {
    const none = new Set<string>();
    const noRep = () => null;
    const card = (key: Parameters<typeof funnelCardStats>[1]) =>
      funnelCardStats(input.estimates, key, none, noRep);
    const stat = (label: string, s: { count: number; totalCents: number }) =>
      `${label}: ${s.count} (${moneyCents(s.totalCents)})`;
    const changes = card("changes");

    const funnelLine = [
      "Estimate funnel (whole book, same buckets as the Estimates page): " +
        [
          stat("Drafts", card("drafts")),
          stat("Awaiting signature", card("sent")),
          stat("Signed contracts", card("signed")),
          stat("Lost (declined/expired)", card("declined")),
          stat("Cancelled", card("void")),
          stat("Change orders pending signature", card("co_pending")),
          `Attached change orders & certificates: ${changes.count} (${moneyCents(changes.totalCents)} signed)`,
        ].join(" | "),
    ].join("\n");

    const recent = [...input.estimates]
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, MAX_ESTIMATES_IN_CONTEXT);
    const docLines = recent.map((e) => {
      const repId = effectiveEstimateRepId({
        status: e.status,
        estimateAssignedTo: e.assigned_to,
        leadAssignedTo: leadById.get(e.lead_id)?.assigned_to,
      });
      const signed = e.signed_at ? ` | signed: ${e.signed_at.slice(0, 10)}` : "";
      return `- ${e.doc_number} | ${ESTIMATE_KIND_LABEL[e.kind] || e.kind} | ${effectiveEstimateStatus(e)} | ${moneyCents(e.total_cents)} | client: ${leadName(e.lead_id)} | rep: ${rep(repId)} | created: ${e.created_at.slice(0, 10)}${signed}`;
    });

    sections.push(
      [
        `ESTIMATES & CONTRACTS:`,
        funnelLine,
        `Documents -- most recent ${recent.length} of ${input.estimates.length} (rely on the funnel line above for totals):`,
        docLines.length ? docLines.join("\n") : "(none)",
      ].join("\n")
    );
  }

  // ── Projects: status for everyone, money only with estimate access ──
  {
    const counts = { in_progress: 0, on_hold: 0, complete: 0, cancelled: 0 };
    for (const p of input.projects) counts[p.status] += 1;

    const live = input.projects.filter((p) => p.status !== "cancelled");
    const moneyLine = input.access.canViewEstimates
      ? `Money across live projects (cancelled excluded): sold ${moneyCents(sum(live, (p) => p.soldCents))} | collected ${moneyCents(sum(live, (p) => p.collectedCents))} | owed ${moneyCents(sum(live, (p) => p.receivableCents))} | net cash ${moneyCents(sum(live, (p) => p.netCashCents))}`
      : null;

    const ordered = [...input.projects].sort((a, b) => {
      const byStatus = PROJECT_STATUS_RANK[a.status] - PROJECT_STATUS_RANK[b.status];
      if (byStatus !== 0) return byStatus;
      const aSigned = a.signedAt ?? "";
      const bSigned = b.signedAt ?? "";
      return aSigned < bSigned ? 1 : aSigned > bSigned ? -1 : 0;
    });
    const lines = ordered.slice(0, MAX_PROJECTS_IN_CONTEXT).map((p) => {
      const base = `- ${p.docNumber} | ${p.customer} | ${p.address || "—"} | ${PROJECT_STATUS_LABEL[p.status]} | rep: ${p.repName || "—"}`;
      if (!input.access.canViewEstimates) return base;
      const pct = p.soldCents > 0 ? ` (${Math.round((p.collectedCents / p.soldCents) * 100)}%)` : "";
      return `${base} | sold ${moneyCents(p.soldCents)} | collected ${moneyCents(p.collectedCents)}${pct} | owed ${moneyCents(p.receivableCents)} | net cash ${moneyCents(p.netCashCents)}`;
    });

    sections.push(
      [
        `PROJECTS (signed jobs):`,
        `${input.projects.length} projects: ${counts.in_progress} in progress, ${counts.on_hold} on hold, ${counts.complete} complete, ${counts.cancelled} cancelled.`,
        ...(moneyLine ? [moneyLine] : []),
        ...(input.projects.length > MAX_PROJECTS_IN_CONTEXT
          ? [`Detail rows below are the ${MAX_PROJECTS_IN_CONTEXT} most relevant (active first); use the lines above for totals.`]
          : []),
        lines.length ? lines.join("\n") : "(none)",
      ].join("\n")
    );
  }

  // ── Money to collect: the Payments page's gate ──
  if (input.access.canViewFinancials) {
    const owing = input.projects
      .filter((p) => p.receivableCents > 0)
      .sort((a, b) => b.receivableCents - a.receivableCents);
    sections.push(
      [
        `MONEY TO COLLECT (billed and unpaid, largest first):`,
        `Total billed & unpaid: ${moneyCents(sum(owing, (p) => p.receivableCents))}`,
        owing.length
          ? owing
              .slice(0, MAX_COLLECT_LINES)
              .map((p) => `- ${p.customer} | ${p.docNumber} | owed ${moneyCents(p.receivableCents)}`)
              .join("\n")
          : "(nothing billed is unpaid)",
      ].join("\n")
    );
  }

  // ── Calls ──
  {
    const outbound = input.calls.filter((c) => c.direction === "outbound").length;
    const totalTalk = sum(input.calls, (c) => c.duration_seconds || 0);
    const byDisposition = new Map<string, number>();
    for (const c of input.calls) {
      const key = c.disposition || "(none)";
      byDisposition.set(key, (byDisposition.get(key) ?? 0) + 1);
    }
    const outcomes = [...byDisposition.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, n]) => `${name} ${n}`)
      .join(", ");

    const recent = [...input.calls]
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, MAX_CALLS_IN_CONTEXT);
    const lines = recent.map((c) => {
      const contact = c.lead_id && leadName(c.lead_id) !== "—" ? ` | contact: ${leadName(c.lead_id)}` : "";
      return `- ${c.created_at.slice(0, 16).replace("T", " ")} | ${c.direction} | ${formatCallDuration(c.duration_seconds || 0)} | ${c.disposition || "—"} | rep: ${rep(c.rep_id)}${contact}`;
    });

    sections.push(
      [
        `CALLS (last ${input.callWindowDays} days):`,
        `${input.calls.length} calls in the last ${input.callWindowDays} days (${outbound} outbound, ${input.calls.length - outbound} inbound), total talk time ${formatCallDuration(totalTalk)}.${outcomes ? ` By outcome: ${outcomes}.` : ""}`,
        `Recent calls -- most recent ${recent.length} of ${input.calls.length}:`,
        lines.length ? lines.join("\n") : "(none)",
      ].join("\n")
    );
  }

  return sections.join("\n\n");
}

function sum<T>(rows: T[], of: (row: T) => number): number {
  return rows.reduce((total, row) => total + of(row), 0);
}
