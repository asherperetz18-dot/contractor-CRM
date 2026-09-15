"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { selectAll } from "@/lib/data/select-all";
import { computeBoardAggregates, type BoardSlimLead } from "@/lib/pipeline-aggregates";
import {
  computeLeadWarnings,
  hasFollowUpDue,
  isColdLead,
  isSettledStage,
  type Lead,
  type LeadFile,
  type LeadNote,
  type LeadTask,
  type LeadWarnings,
} from "@/lib/data/types";
import type {
  BoardCard,
  PipelineBoardData,
  PipelineBoardQuery,
} from "@/lib/pipeline-board-types";

/**
 * The pipeline board's server side.
 *
 * The page used to ship every lead in the company (all columns, notes
 * included), every task, every note, and the file list to the browser,
 * and reduce the stat tiles there. Same cure as the Power Dialer
 * (DECISIONS #019): the browser gets each column's first window of
 * cards plus exact counts, the stat tiles arrive as numbers computed
 * here from a slim scan, and a lead's tasks/notes/files travel only
 * when its card is opened.
 */

const BOARD_COLUMNS =
  "id, contact_type, company_name, first_name, last_name, phone, email, address, source, project_type, stage, value, assigned_to, dispatcher_id, date_received, has_appt, created_at";

/** How many leads the attention digest examines: the newest open slice
 *  of the book, where the leads being actively worked live. Exact
 *  warnings need each lead's notes, which forbids scanning all 79k. */
const DIGEST_WINDOW = 1000;
const DIGEST_LIST_CAP = 100;
const WON_LIST_CAP = 50;

/** Same structural slice as dial-contacts.ts: the generated builder
 *  type trips TS2589 under a generic, and every query here must go
 *  through the same applyFilters so columns, counts, and aggregates
 *  describe the same rows. */
type LeadsQuery = {
  eq(column: string, value: unknown): LeadsQuery;
  is(column: string, value: unknown): LeadsQuery;
  not(column: string, operator: string, value: unknown): LeadsQuery;
  gte(column: string, value: unknown): LeadsQuery;
  lt(column: string, value: unknown): LeadsQuery;
  order(column: string, opts: { ascending: boolean }): LeadsQuery;
  range(from: number, to: number): LeadsQuery;
  limit(n: number): LeadsQuery;
  then<R>(
    onfulfilled: (value: {
      data: unknown[] | null;
      count: number | null;
      error: { message: string } | null;
    }) => R
  ): PromiseLike<R>;
};

function applyFilters(q: LeadsQuery, companyId: string, input: PipelineBoardQuery): LeadsQuery {
  let out = q.eq("company_id", companyId);
  if (input.repFilter === "unassigned") out = out.is("assigned_to", null);
  else if (input.repFilter !== "All") out = out.eq("assigned_to", input.repFilter);
  if (input.receivedSince) out = out.gte("date_received", input.receivedSince);
  if (input.receivedBefore) out = out.lt("date_received", input.receivedBefore);
  if (input.noApptOnly) out = out.eq("has_appt", false);
  return out;
}

function applySort(q: LeadsQuery, input: PipelineBoardQuery): LeadsQuery {
  const asc = input.sortDir === "asc";
  if (input.sortBy === "Amount") return q.order("value", { ascending: asc }).order("created_at", { ascending: false });
  if (input.sortBy === "Name")
    // Display names mix company/first/last; ordering by the three
    // columns is the closest the database can come to that.
    return q
      .order("company_name", { ascending: asc })
      .order("first_name", { ascending: asc })
      .order("last_name", { ascending: asc });
  // "Days" sorts by age; ascending age = newest received first.
  return q.order("date_received", { ascending: !asc }).order("created_at", { ascending: false });
}

async function fetchStageWindow(
  supabase: Awaited<ReturnType<typeof createClient>>,
  companyId: string,
  input: PipelineBoardQuery,
  stage: string,
  offset: number,
  limit: number
): Promise<{ cards: BoardCard[]; count: number }> {
  const q = applySort(
    applyFilters(
      supabase.from("leads").select(BOARD_COLUMNS, { count: "exact" }) as unknown as LeadsQuery,
      companyId,
      input
    ).eq("stage", stage),
    input
  );
  const { data, count, error } = await q.range(offset, offset + limit - 1);
  if (error) return { cards: [], count: 0 };
  return { cards: (data ?? []) as BoardCard[], count: count ?? 0 };
}

export async function getPipelineBoardData(input: PipelineBoardQuery): Promise<PipelineBoardData | null> {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const companyId = profile.company_id;
  const supabase = await createClient();

  const { data: stageRows } = await supabase
    .from("pipeline_stages")
    .select("name")
    .eq("company_id", companyId)
    .order("sort_order", { ascending: true });
  const openStages = ((stageRows ?? []) as { name: string }[])
    .map((s) => s.name)
    .filter((s) => !isSettledStage(s));

  const columnStages = input.statusFilter === "Open" ? openStages : [input.statusFilter];

  const [columns, slim, wonTopRes, totalRes, digest] = await Promise.all([
    Promise.all(
      columnStages.map(async (stage) => ({
        stage,
        ...(await fetchStageWindow(supabase, companyId, input, stage, 0, input.window)),
      }))
    ),
    // The stat tiles reflect the rep filter but not age/appt/status --
    // exactly what the in-browser reduction did.
    selectAll<BoardSlimLead>((f, t) =>
      applyFilters(
        supabase.from("leads").select("stage, value, has_appt, date_received") as unknown as LeadsQuery,
        companyId,
        { ...input, receivedSince: "", receivedBefore: "", noApptOnly: false }
      ).range(f, t) as unknown as PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>
    ),
    applyFilters(
      supabase.from("leads").select(BOARD_COLUMNS) as unknown as LeadsQuery,
      companyId,
      { ...input, receivedSince: "", receivedBefore: "", noApptOnly: false }
    )
      .eq("stage", "Won")
      .order("value", { ascending: false })
      .limit(WON_LIST_CAP),
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId),
    buildDigest(supabase, companyId, input),
  ]);

  return {
    columns,
    aggregates: computeBoardAggregates(slim),
    wonTop: ((wonTopRes.data ?? []) as BoardCard[]),
    totalLeads: totalRes.count ?? 0,
    digest,
  };
}

/**
 * Follow-ups due and cold leads, computed exactly -- warnings need each
 * lead's notes text and open tasks -- over the newest DIGEST_WINDOW
 * open leads rather than the whole book. The digest is a to-do list for
 * the leads being worked now; 70k dormant imports would drown it (and
 * their notes would be a 100MB read) without making it more actionable.
 */
async function buildDigest(
  supabase: Awaited<ReturnType<typeof createClient>>,
  companyId: string,
  input: PipelineBoardQuery
) {
  const [{ data: windowRows }, tasks] = await Promise.all([
    applyFilters(
      supabase
        .from("leads")
        .select(BOARD_COLUMNS + ", notes, notes_updated_at") as unknown as LeadsQuery,
      companyId,
      { ...input, receivedSince: "", receivedBefore: "", noApptOnly: false }
    )
      .not("stage", "in", "(Won,Lost)")
      .order("created_at", { ascending: false })
      .limit(DIGEST_WINDOW),
    selectAll<Pick<LeadTask, "lead_id" | "due_date" | "completed_at">>((f, t) =>
      supabase
        .from("lead_tasks")
        .select("lead_id, due_date, completed_at")
        .eq("company_id", companyId)
        .range(f, t)
    ),
  ]);

  const tasksByLead = new Map<string, Pick<LeadTask, "lead_id" | "due_date" | "completed_at">[]>();
  for (const t of tasks) {
    const list = tasksByLead.get(t.lead_id) ?? [];
    list.push(t);
    tasksByLead.set(t.lead_id, list);
  }

  const followUpsDue: BoardCard[] = [];
  const coldLeads: BoardCard[] = [];
  const warnings: Record<string, LeadWarnings> = {};
  let followUpsDueCount = 0;
  let coldLeadsCount = 0;

  const rows = (windowRows ?? []) as (BoardCard & {
    notes: string | null;
    notes_updated_at: string | null;
  })[];
  for (const l of rows) {
    const leadTasks = (tasksByLead.get(l.id) ?? []) as LeadTask[];
    const w = computeLeadWarnings(l, l.has_appt, leadTasks);
    if (hasFollowUpDue(leadTasks)) {
      followUpsDueCount += 1;
      if (followUpsDue.length < DIGEST_LIST_CAP) {
        followUpsDue.push(l);
        warnings[l.id] = w;
      }
    }
    if (isColdLead(w)) {
      coldLeadsCount += 1;
      if (coldLeads.length < DIGEST_LIST_CAP) {
        coldLeads.push(l);
        warnings[l.id] = w;
      }
    }
  }

  return {
    followUpsDue,
    followUpsDueCount,
    coldLeads,
    coldLeadsCount,
    warnings,
    windowSize: rows.length,
  };
}

/** More cards for one column (scroll), or a stage's top deals by value
 *  (the value-breakdown drilldown, which passes an Amount sort). */
export async function getStageCards(
  input: PipelineBoardQuery,
  stage: string,
  offset: number,
  limit: number
): Promise<{ cards: BoardCard[]; count: number }> {
  const profile = await getCurrentProfile();
  if (!profile) return { cards: [], count: 0 };
  const supabase = await createClient();
  return fetchStageWindow(supabase, profile.company_id, input, stage, offset, Math.min(limit, 200));
}

/**
 * Everything the lead window needs, fetched when a card is opened: the
 * full row plus its tasks, notes, and files. These used to ride with
 * the page for every lead in the company at once.
 */
export async function getLeadCard(leadId: string): Promise<{
  lead: Lead;
  tasks: LeadTask[];
  notes: LeadNote[];
  files: LeadFile[];
} | null> {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const supabase = await createClient();

  const [{ data: lead }, { data: tasks }, { data: notes }, { data: files }] = await Promise.all([
    supabase.from("leads").select("*").eq("id", leadId).eq("company_id", profile.company_id).maybeSingle(),
    supabase
      .from("lead_tasks")
      .select("id, lead_id, title, due_date, due_time, completed_at, assigned_to, created_at")
      .eq("lead_id", leadId),
    supabase
      .from("lead_notes")
      .select("id, lead_id, author_id, body, event_id, created_at")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false }),
    supabase
      .from("lead_files")
      .select(
        "id, lead_id, uploaded_by, file_name, file_path, file_url, file_size, content_type, storage_provider, created_at"
      )
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false }),
  ]);

  if (!lead) return null;
  return {
    lead: lead as Lead,
    tasks: (tasks ?? []) as LeadTask[],
    notes: (notes ?? []) as LeadNote[],
    files: (files ?? []) as LeadFile[],
  };
}
