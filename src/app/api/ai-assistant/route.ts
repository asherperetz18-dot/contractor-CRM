import { addDays } from "@/lib/company-clock";
import { companyToday } from "@/lib/data/company-today";
import Anthropic from "@anthropic-ai/sdk";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { withRouteObservability } from "@/lib/observability/observe";
import { captureError } from "@/lib/observability/sentry";
import { aiFailureFromError } from "@/lib/ai-failure";
import { selectAll } from "@/lib/data/select-all";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import {
  isAdminRole,
  canViewEstimates,
  leadDisplayName,
  type ContactType,
} from "@/lib/data/types";
import { canViewFinancials } from "@/lib/data/accounting-access";
import { buildProjectCards } from "@/app/(app)/projects/project-data";
import {
  assistantRepScope,
  buildAssistantContext,
  CALL_WINDOW_DAYS,
  MAX_ESTIMATES_IN_CONTEXT,
  MAX_CALLS_IN_CONTEXT,
  MAX_LEADS_IN_CONTEXT,
  type AssistantRepScope,
  type AssistantCall,
  type AssistantChecklistItem,
  type AssistantEstimate,
  type AssistantEvent,
  type AssistantLead,
  type AssistantTask,
} from "@/lib/data/assistant-context";
import {
  encodeAssistantEvent,
  sanitizeHistory,
  type AssistantStreamEvent,
} from "@/lib/data/assistant-stream";
import {
  MAX_TARGETS_PER_PROPOSAL,
  MAX_CHECKLIST_ITEMS_PER_PROPOSAL,
  parseChecklistAddParams,
  parseChecklistCheckParams,
  type AiActionType,
  type ProposalRow,
} from "@/lib/data/ai-proposals";

/**
 * The AI assistant chat, as a streaming route handler rather than a
 * Server Action: an action buffers the whole reply (and re-runs the
 * layout), so the person read nothing until everything was written.
 * This streams each token as NDJSON the moment the model produces it.
 * Auth is the caller's own cookie session -- every query below runs
 * under their RLS, so the assistant can never read past the viewer.
 */

// Streaming a long answer over site cellular can outlive the default.
export const maxDuration = 60;

// The assistant can suggest changes but never performs them. Each tool
// call is captured as a pending proposal row for a human to approve; no
// tool result is ever fed back, so there is no autonomous execution loop.
const PROPOSAL_TOOLS: Anthropic.Tool[] = [
  {
    name: "propose_move_lead_stage",
    description:
      "Propose moving specific leads to a different pipeline stage. This does NOT change anything — it creates a suggestion the user must approve first.",
    input_schema: {
      type: "object",
      properties: {
        lead_ids: {
          type: "array",
          items: { type: "string" },
          description: "Exact lead ids copied from the LEADS data provided.",
        },
        stage: {
          type: "string",
          description: "Exact name of an existing pipeline stage.",
        },
        summary: {
          type: "string",
          description:
            "One plain sentence describing the change and why, for the user to review before approving.",
        },
      },
      required: ["lead_ids", "stage", "summary"],
    },
  },
  {
    name: "propose_assign_leads",
    description:
      "Propose assigning specific leads to a rep. This does NOT change anything — it creates a suggestion the user must approve first.",
    input_schema: {
      type: "object",
      properties: {
        lead_ids: {
          type: "array",
          items: { type: "string" },
          description: "Exact lead ids copied from the LEADS data provided.",
        },
        assigned_to: {
          type: "string",
          description: "The rep's id, copied from the TEAM list provided.",
        },
        summary: { type: "string", description: "One plain sentence describing the change." },
      },
      required: ["lead_ids", "assigned_to", "summary"],
    },
  },
  {
    name: "propose_create_tasks",
    description:
      "Propose creating a follow-up task on specific leads. This does NOT change anything — it creates a suggestion the user must approve first.",
    input_schema: {
      type: "object",
      properties: {
        lead_ids: {
          type: "array",
          items: { type: "string" },
          description: "Exact lead ids copied from the LEADS data provided.",
        },
        title: { type: "string", description: "Short task title, e.g. 'Follow-up call'." },
        due_date: { type: "string", description: "Due date as YYYY-MM-DD." },
        summary: { type: "string", description: "One plain sentence describing the change." },
      },
      required: ["lead_ids", "title", "due_date", "summary"],
    },
  },
  {
    name: "propose_add_checklist_items",
    description:
      "Propose adding steps to a project's checklist. This does NOT change anything — it creates a suggestion the user must approve first.",
    input_schema: {
      type: "object",
      properties: {
        project_id: {
          type: "string",
          description: "Exact project id copied from the PROJECTS list.",
        },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "The step, e.g. 'Order shingles'." },
              due_date: {
                type: "string",
                description: "Due date as YYYY-MM-DD; omit when the user didn't give one.",
              },
            },
            required: ["label"],
          },
          description: `The steps to add, at most ${MAX_CHECKLIST_ITEMS_PER_PROPOSAL}.`,
        },
        summary: { type: "string", description: "One plain sentence describing the change." },
      },
      required: ["project_id", "items", "summary"],
    },
  },
  {
    name: "propose_check_checklist_items",
    description:
      "Propose marking checklist steps as done. This does NOT change anything — it creates a suggestion the user must approve first.",
    input_schema: {
      type: "object",
      properties: {
        item_ids: {
          type: "array",
          items: { type: "string" },
          description: "Exact item ids copied from the PROJECT CHECKLISTS data.",
        },
        summary: { type: "string", description: "One plain sentence describing the change." },
      },
      required: ["item_ids", "summary"],
    },
  },
];

const TOOL_TO_ACTION: Record<string, AiActionType> = {
  propose_move_lead_stage: "move_lead_stage",
  propose_assign_leads: "assign_leads",
  propose_create_tasks: "create_tasks",
  propose_add_checklist_items: "add_checklist_items",
  propose_check_checklist_items: "check_checklist_items",
};

/** How many records a proposal touches, per action — or null when the
 *  params don't survive validation and no card should be created. */
function proposalTargetCount(
  actionType: AiActionType,
  input: Record<string, unknown>
): number | null {
  if (actionType === "add_checklist_items") {
    const parsed = parseChecklistAddParams(input);
    return parsed ? parsed.items.length : null;
  }
  if (actionType === "check_checklist_items") {
    const parsed = parseChecklistCheckParams(input);
    return parsed ? parsed.itemIds.length : null;
  }
  const leadIds = Array.isArray(input.lead_ids)
    ? input.lead_ids.filter((v): v is string => typeof v === "string")
    : [];
  if (leadIds.length === 0 || leadIds.length > MAX_TARGETS_PER_PROPOSAL) return null;
  return leadIds.length;
}

const CALL_FETCH_CAP = 3000;

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Access = { canViewEstimates: boolean; canViewFinancials: boolean };

async function gatherContext(
  supabase: Supabase,
  companyId: string,
  access: Access,
  repScope: AssistantRepScope | null
) {
  const todayISO = await companyToday();
  const callWindowStart = new Date(Date.now() - CALL_WINDOW_DAYS * 86400000).toISOString();

  // A rep-scoped viewer gets only their own rows, filtered at the
  // query so the caps and summaries all describe THEIR book. match({})
  // is a no-op for desk roles.
  const repMatch = repScope ? { assigned_to: repScope.id } : {};

  const [
    { data: companyProfile },
    members,
    { data: leads },
    allLeadTotals,
    { data: stages },
    { data: events },
    { data: tasks },
    estimates,
    projectCards,
    checklists,
    calls,
  ] = await Promise.all([
    supabase.from("company_profile").select("name").eq("company_id", companyId).single(),
    getCompanyMembers(companyId),
    supabase
      .from("leads")
      .select(
        "id, contact_type, company_name, first_name, last_name, phone, email, source, project_type, stage, value, assigned_to, date_received, created_at"
      )
      .eq("company_id", companyId)
      .match(repMatch)
      .order("created_at", { ascending: false })
      .limit(MAX_LEADS_IN_CONTEXT),
    // Narrow columns, and genuinely every row -- true totals,
    // independent of the MAX_LEADS_IN_CONTEXT cap on the detailed
    // roster above. This said "unlimited" and was not: PostgREST stops
    // at 1000, so on 1520 leads the assistant answered "how many open
    // leads" from two thirds of the book while sounding certain, and
    // disagreed with the Dashboard it was meant to corroborate.
    selectAll<{ stage: string; value: number }>((rangeFrom, rangeTo) =>
      supabase
        .from("leads")
        .select("stage, value")
        .eq("company_id", companyId)
        .match(repMatch)
        .range(rangeFrom, rangeTo)
    ),
    supabase
      .from("pipeline_stages")
      .select("id, name, sort_order")
      .eq("company_id", companyId)
      .order("sort_order", { ascending: true }),
    supabase
      .from("events")
      .select("id, title, date, time, end_time, event_type, status, assigned_to, lead_id")
      .eq("company_id", companyId)
      .match(repMatch)
      .gte("date", addDays(todayISO, -1))
      .lte("date", addDays(todayISO, 14))
      .order("date", { ascending: true })
      .order("time", { ascending: true })
      .limit(150),
    supabase
      .from("lead_tasks")
      .select("id, lead_id, title, due_date, completed_at, assigned_to")
      .eq("company_id", companyId)
      .match(repMatch)
      .is("completed_at", null)
      .lte("due_date", addDays(todayISO, 30))
      .order("due_date", { ascending: true })
      .limit(150),
    // The Estimates page's own gate; without it the section never
    // renders, so its rows are never fetched either.
    access.canViewEstimates
      ? selectAll<AssistantEstimate>((rangeFrom, rangeTo) =>
          supabase
            .from("estimates")
            .select(
              "id, lead_id, doc_number, title, status, kind, total_cents, expires_at, signed_at, created_at, assigned_to, parent_estimate_id"
            )
            .eq("company_id", companyId)
            .match(repMatch)
            .range(rangeFrom, rangeTo)
        )
      : Promise.resolve([] as AssistantEstimate[]),
    // The same rollup the Projects board and the printable reports
    // read, so the assistant can never quote a different number than
    // the page. RLS hands a role without cost access empty bills and
    // expenses, and those figures simply read lower for them.
    buildProjectCards(supabase, companyId),
    // Open checklist steps carry no dollars, so every role reads them.
    selectAll<AssistantChecklistItem>((rangeFrom, rangeTo) =>
      supabase
        .from("project_checklist_items")
        .select("id, estimate_id, label, due_date, assigned_to")
        .eq("company_id", companyId)
        .match(repMatch)
        .is("completed_at", null)
        .range(rangeFrom, rangeTo)
    ),
    // Capped, newest first — a power-dialer month is tens of thousands
    // of rows, and an unbounded fetch here is pure latency for counts
    // the summary will honestly label as "most recent N" anyway.
    (async () => {
      const rows: AssistantCall[] = [];
      for (let from = 0; from < CALL_FETCH_CAP; from += 1000) {
        const { data, error } = await supabase
          .from("call_logs")
          .select("created_at, direction, disposition, status, duration_seconds, rep_id, lead_id")
          .eq("company_id", companyId)
          .match(repScope ? { rep_id: repScope.id } : {})
          .gte("created_at", callWindowStart)
          .order("created_at", { ascending: false })
          .range(from, from + 999);
        if (error || !data) break;
        rows.push(...(data as AssistantCall[]));
        if (data.length < 1000) break;
      }
      return rows;
    })(),
  ]);

  const team = members.map((m) => ({ id: m.id, name: m.name || m.email || "Unnamed" }));
  const roster = (leads ?? []) as AssistantLead[];

  // Names for customers referenced by documents and calls whose lead is
  // too old for the 400-row roster -- fetched by id, never by shipping
  // more of the 79k contact book.
  const rosterIds = new Set(roster.map((l) => l.id));
  const wanted = new Set<string>();
  const noteWanted = (id: string | null | undefined) => {
    if (id && !rosterIds.has(id)) wanted.add(id);
  };
  [...estimates]
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, MAX_ESTIMATES_IN_CONTEXT)
    .forEach((e) => noteWanted(e.lead_id));
  calls.slice(0, MAX_CALLS_IN_CONTEXT).forEach((c) => noteWanted(c.lead_id));
  ((events ?? []) as AssistantEvent[]).forEach((ev) => noteWanted(ev.lead_id));
  ((tasks ?? []) as AssistantTask[]).forEach((t) => noteWanted(t.lead_id));

  const extraLeadNames = new Map<string, string>();
  if (wanted.size > 0) {
    const { data: named } = await supabase
      .from("leads")
      .select("id, contact_type, company_name, first_name, last_name")
      .eq("company_id", companyId)
      .in("id", [...wanted]);
    const namedRows = (named ?? []) as {
      id: string;
      contact_type: ContactType | null;
      company_name: string | null;
      first_name: string | null;
      last_name: string | null;
    }[];
    for (const l of namedRows) {
      extraLeadNames.set(
        l.id,
        leadDisplayName({ ...l, contact_type: l.contact_type ?? "Individual" })
      );
    }
  }

  // Projects can't be filtered at fetch (the rollup is one company-wide
  // pass), so a rep's cards are the ones behind their own documents or
  // their own checklist steps -- covers both a salesperson and a crew
  // member who holds steps but no document access.
  let visibleCards = projectCards.cards;
  if (repScope) {
    const mineEstimateIds = new Set<string>([
      ...estimates.map((e) => e.id),
      ...checklists.map((c) => c.estimate_id),
    ]);
    visibleCards = projectCards.cards.filter((card) => mineEstimateIds.has(card.estimateId));
  }

  return buildAssistantContext({
    companyName: (companyProfile as { name: string | null } | null)?.name || "this company",
    todayISO,
    stages: (((stages ?? []) as { name: string }[]) || []).map((s) => s.name),
    team,
    access,
    leads: roster,
    leadTotals: (allLeadTotals as { stage: string; value: number }[] | null) ?? [],
    events: ((events ?? []) as AssistantEvent[]) ?? [],
    tasks: ((tasks ?? []) as AssistantTask[]) ?? [],
    estimates,
    repScope,
    projects: visibleCards.map((card) => ({
      estimateId: card.estimateId,
      docNumber: card.docNumber,
      title: card.title,
      customer: card.customer,
      address: card.address,
      status: card.status,
      repName: card.repName,
      signedAt: card.signedAt,
      startDate: card.startDate,
      completionDate: card.completionDate,
      soldCents: card.rollup.soldCents,
      collectedCents: card.rollup.collectedCents,
      receivableCents: card.rollup.receivableCents,
      costCents: card.rollup.costCents,
      netCashCents: card.rollup.netCashCents,
      unpaidBillsCents: card.unpaidBillsCents,
    })),
    checklists,
    calls,
    callWindowDays: CALL_WINDOW_DAYS,
    callsCapped: calls.length >= CALL_FETCH_CAP,
    extraLeadNames,
  });
}

async function handlePost(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { messages?: unknown } | null;
  const history = sanitizeHistory(body?.messages);
  if (history.length === 0) {
    return Response.json({ error: "Ask a question first." }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "AI assistant isn't configured yet." }, { status: 500 });
  }

  // Only roles that are allowed to approve bulk changes get the proposal
  // tools at all, so a Sales user can't generate suggestions they could
  // never apply.
  const mayPropose = profile.roles.includes("Office") || isAdminRole(profile);
  const access: Access = {
    canViewEstimates: canViewEstimates(profile),
    canViewFinancials: canViewFinancials(profile),
  };

  // A rep-only viewer (Sales/Field with no desk role) chats about their
  // own book: every fetch below is filtered to them, and the context
  // says so. Desk roles keep the whole company.
  const repScope = assistantRepScope(profile);

  const supabase = await createClient();
  let context: string;
  try {
    context = await gatherContext(supabase, profile.company_id, access, repScope);
  } catch {
    return Response.json(
      { error: "Couldn't load your data right now. Try again in a moment." },
      { status: 500 }
    );
  }

  // Two system blocks with their own cache breakpoints: the instructions
  // never change for a given role, so they stay a cache hit even on a
  // day the data block underneath them has moved.
  const instructions = [
    "You are the AI assistant inside a contractor CRM. Answer the user's questions about their leads, pipeline, schedule, tasks, estimates, projects, money to collect, and calls using ONLY the data provided below.",
    "Be concise and direct — a sentence or short list is usually enough. Use dollar amounts and dates exactly as given.",
    "Respond in plain text only — the chat UI does not render markdown. Do not use **bold**, _italics_, headers, or markdown links. Plain '- ' list items are fine.",
    "Sections carry their own accurate totals (the Summary, funnel and section header lines). Use those for any count or value question; the detail lines under them are only the most recent records, so never answer a total by counting lines.",
    "If the data below doesn't contain the answer (or the section for it isn't present), say so plainly instead of guessing.",
    mayPropose
      ? [
          "You cannot change anything directly. You CAN suggest a change using the propose_* tools — move leads between pipeline stages, assign leads to a rep, create follow-up tasks, add steps to a project's checklist, or check checklist steps off. Each creates a suggestion the user must review and approve before it takes effect.",
          `Only propose a change when the user clearly asks for one. Never propose speculatively, and never propose more than ${MAX_TARGETS_PER_PROPOSAL} records at once.`,
          "Copy lead, rep, project and checklist item ids exactly from the data below — never invent one.",
          "When you propose something, also say in plain text what you proposed and that it needs their approval.",
        ].join("\n")
      : "You cannot take actions (create, edit, or delete anything) — you can only answer questions. If asked to perform an action, explain that and suggest where in the app to do it.",
  ].join("\n");

  const client = new Anthropic({ apiKey });
  const apiMessages = history.map((m) => ({ role: m.role, content: m.content }));

  type StreamParams = Parameters<Anthropic["messages"]["stream"]>[0];

  const fullRequest: StreamParams = {
    model: "claude-opus-5",
    max_tokens: 4096,
    system: [
      { type: "text", text: instructions, cache_control: { type: "ephemeral" } },
      {
        type: "text",
        text: "=== CURRENT DATA ===\n" + context,
        cache_control: { type: "ephemeral" },
      },
    ],
    output_config: { effort: "low" },
    ...(mayPropose ? { tools: PROPOSAL_TOOLS } : {}),
    messages: apiMessages,
  };

  // The same call minus the two newest request features. If the full
  // shape is rejected upfront (HTTP 400), this one still answers the
  // person while Sentry records which shape failed -- the RPC-with-a-
  // fallback discipline, applied to the model call.
  const conservativeRequest: StreamParams = {
    model: "claude-opus-5",
    max_tokens: 4096,
    system: [
      { type: "text", text: instructions },
      { type: "text", text: "=== CURRENT DATA ===\n" + context },
    ],
    ...(mayPropose ? { tools: PROPOSAL_TOOLS } : {}),
    messages: apiMessages,
  };

  const encoder = new TextEncoder();
  const responseBody = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AssistantStreamEvent) =>
        controller.enqueue(encoder.encode(encodeAssistantEvent(event)));
      try {
        let streamedChars = 0;
        const runAttempt = async (params: StreamParams) => {
          const stream = client.messages.stream(params);
          for await (const event of stream) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              streamedChars += event.delta.text.length;
              send({ type: "text", text: event.delta.text });
            }
          }
          return stream.finalMessage();
        };

        let response: Anthropic.Message;
        try {
          response = await runAttempt(fullRequest);
        } catch (error) {
          // Retry only a clean upfront rejection -- after any streamed
          // text a second attempt would double what the person read.
          const rejected =
            error instanceof Anthropic.APIError && error.status === 400 && streamedChars === 0;
          if (!rejected) throw error;
          captureError(error, { route: "api.ai-assistant", service: "anthropic-full-shape" });
          console.error("[ai-assistant] full request shape rejected, retrying plain", error);
          response = await runAttempt(conservativeRequest);
        }

        if (response.stop_reason === "refusal") {
          send({ type: "error", message: "The assistant couldn't answer that question." });
          return;
        }

        // Tool calls are recorded as pending suggestions and nothing
        // more -- no tool_result is returned to the model, so it cannot
        // chain into actually performing the change.
        const toolUses = response.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
        );
        const proposals: ProposalRow[] = [];
        let proposalError = "";

        if (mayPropose && toolUses.length > 0) {
          for (const use of toolUses) {
            const actionType = TOOL_TO_ACTION[use.name];
            if (!actionType) continue;
            const input = (use.input ?? {}) as Record<string, unknown>;
            const targetCount = proposalTargetCount(actionType, input);
            if (targetCount === null) continue;

            const summary =
              typeof input.summary === "string" && input.summary.trim()
                ? input.summary.trim()
                : "Suggested change";

            const { data: inserted, error: insertError } = await supabase
              .from("ai_action_proposals")
              .insert({
                company_id: profile.company_id,
                proposed_by: profile.id,
                action_type: actionType,
                params: input,
                summary,
                target_count: targetCount,
              })
              .select(
                "id, action_type, params, summary, target_count, status, result, error, created_at, decided_at"
              )
              .maybeSingle();
            if (inserted) proposals.push(inserted as ProposalRow);
            // Surfaced rather than swallowed -- otherwise the assistant
            // would claim it suggested something and no card would ever
            // appear.
            else if (insertError) proposalError = insertError.message;
          }
        }

        if (streamedChars === 0) {
          send({
            type: "text",
            text: proposals.length
              ? "I've put that together as a suggestion below — review it and approve if it looks right."
              : "I don't have an answer for that.",
          });
        }
        if (proposalError && proposals.length === 0) {
          send({
            type: "text",
            text: `\n\n(I couldn't save that suggestion for approval: ${proposalError})`,
          });
        }
        if (proposals.length > 0) {
          send({ type: "proposals", proposals });
        }
        send({ type: "done" });
      } catch (error) {
        // The category (and, for a rejected request, the API's own
        // reason) reaches the person; the full error reaches Sentry.
        // One generic line hid a production failure completely.
        console.error("[ai-assistant] stream failed", error);
        captureError(error, { route: "api.ai-assistant", service: "anthropic" });
        send({ type: "error", message: aiFailureFromError(error) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(responseBody, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export const POST = withRouteObservability("api.ai-assistant", handlePost);
