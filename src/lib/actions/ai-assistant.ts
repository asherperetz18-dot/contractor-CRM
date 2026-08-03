"use server";

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import {
  isAdminRole,
  leadDisplayName,
  money,
  type Lead,
  type Event,
  type LeadTask,
  type PipelineStageRow,
} from "@/lib/data/types";
import {
  MAX_TARGETS_PER_PROPOSAL,
  type AiActionType,
  type ProposalRow,
} from "@/lib/data/ai-proposals";

export type ChatMessage = { role: "user" | "assistant"; content: string };

const MAX_LEADS_IN_CONTEXT = 400;
const MAX_HISTORY_MESSAGES = 12;

// The assistant can suggest changes but never performs them. Each tool call
// is captured as a pending proposal row for a human to approve; no tool
// result is ever fed back, so there is no autonomous execution loop.
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
];

const TOOL_TO_ACTION: Record<string, AiActionType> = {
  propose_move_lead_stage: "move_lead_stage",
  propose_assign_leads: "assign_leads",
  propose_create_tasks: "create_tasks",
};

function isoDaysFromNow(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function buildContext(companyId: string): Promise<string> {
  const supabase = await createClient();
  const todayISO = new Date().toISOString().slice(0, 10);

  const [{ data: companyProfile }, members, { data: leads }, { data: allLeadTotals }, { data: stages }, { data: events }, { data: tasks }] =
    await Promise.all([
      supabase.from("company_profile").select("name").eq("company_id", companyId).single(),
      getCompanyMembers(companyId),
      supabase
        .from("leads")
        .select(
          "id, contact_type, company_name, first_name, last_name, phone, email, source, project_type, stage, value, assigned_to, date_received, created_at"
        )
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(MAX_LEADS_IN_CONTEXT),
      // Unlimited, narrow columns -- true totals, independent of the
      // MAX_LEADS_IN_CONTEXT cap on the detailed roster below. Without
      // this, "how many open leads" answers from the truncated list and
      // silently disagrees with the Dashboard's real count.
      supabase.from("leads").select("stage, value").eq("company_id", companyId),
      supabase
        .from("pipeline_stages")
        .select("id, name, sort_order")
        .eq("company_id", companyId)
        .order("sort_order", { ascending: true }),
      supabase
        .from("events")
        .select("id, title, date, time, event_type, status, assigned_to, lead_id")
        .eq("company_id", companyId)
        .gte("date", isoDaysFromNow(-1))
        .lte("date", isoDaysFromNow(14))
        .order("date", { ascending: true })
        .order("time", { ascending: true })
        .limit(150),
      supabase
        .from("lead_tasks")
        .select("id, lead_id, title, due_date, completed_at, assigned_to")
        .eq("company_id", companyId)
        .is("completed_at", null)
        .lte("due_date", isoDaysFromNow(30))
        .order("due_date", { ascending: true })
        .limit(150),
    ]);

  const repName = new Map(members.map((m) => [m.id, m.name || m.email || "Unassigned"]));
  const leadById = new Map((leads as Lead[] | null)?.map((l) => [l.id, l]) ?? []);
  const companyName = (companyProfile as { name: string | null } | null)?.name || "this company";

  const allLeads = (leads as Lead[] | null) ?? [];
  const totalsRows = (allLeadTotals as { stage: string; value: number }[] | null) ?? [];
  const openTotalsRows = totalsRows.filter((l) => l.stage !== "Won" && l.stage !== "Lost");
  const totalLeadCount = totalsRows.length;
  const openLeadCount = openTotalsRows.length;
  const openPipelineValue = openTotalsRows.reduce((sum, l) => sum + (Number(l.value) || 0), 0);

  const leadLines = allLeads.map((l) => {
    const rep = l.assigned_to ? repName.get(l.assigned_to) || "Unassigned" : "Unassigned";
    // The id is included so a proposed change can name exact records. Every
    // id is re-validated against this company before anything is applied.
    return `- id: ${l.id} | ${leadDisplayName(l)} | phone: ${l.phone || "—"} | email: ${l.email || "—"} | stage: ${l.stage} | value: ${money(
      l.value
    )} | source: ${l.source || "—"} | project: ${l.project_type || "—"} | rep: ${rep} | received: ${l.date_received}`;
  });

  const eventLines = ((events as Event[] | null) ?? []).map((ev) => {
    const rep = ev.assigned_to ? repName.get(ev.assigned_to) || "Unassigned" : "Unassigned";
    const lead = ev.lead_id ? leadById.get(ev.lead_id) : null;
    return `- ${ev.date} ${ev.time || ""} | ${ev.title || ev.event_type} | ${ev.event_type} | status: ${ev.status} | rep: ${rep}${
      lead ? ` | contact: ${leadDisplayName(lead)}` : ""
    }`;
  });

  const taskLines = ((tasks as LeadTask[] | null) ?? []).map((t) => {
    const rep = t.assigned_to ? repName.get(t.assigned_to) || "Unassigned" : "Unassigned";
    const lead = leadById.get(t.lead_id);
    const overdue = t.due_date < todayISO ? " (OVERDUE)" : "";
    return `- Due ${t.due_date}${overdue} | ${t.title} | rep: ${rep}${lead ? ` | contact: ${leadDisplayName(lead)}` : ""}`;
  });

  const stageLines = ((stages as PipelineStageRow[] | null) ?? []).map((s) => s.name).join(", ");

  const teamLines = members.map((m) => `- id: ${m.id} | ${m.name || m.email || "Unnamed"}`);

  return [
    `Company: ${companyName}`,
    `Today's date: ${todayISO}`,
    `Pipeline stages (in order): ${stageLines || "none configured"}`,
    "",
    `TEAM (use these ids when proposing an assignment):`,
    teamLines.length ? teamLines.join("\n") : "(none)",
    "",
    `Summary (accurate company-wide totals -- use these for any count/value question): ${openLeadCount} open leads worth ${money(openPipelineValue)} total, out of ${totalLeadCount} leads overall.`,
    "",
    `LEADS -- detail roster, most recent ${allLeads.length} of ${totalLeadCount} total (older leads are omitted here; rely on the Summary above for totals, not a count of this list):`,
    leadLines.length ? leadLines.join("\n") : "(none)",
    "",
    `UPCOMING/RECENT APPOINTMENTS (yesterday through next 14 days):`,
    eventLines.length ? eventLines.join("\n") : "(none)",
    "",
    `OPEN TASKS (due within 30 days or overdue):`,
    taskLines.length ? taskLines.join("\n") : "(none)",
  ].join("\n");
}

export async function askAssistant(
  history: ChatMessage[]
): Promise<{ error?: string; reply?: string; proposals?: ProposalRow[] }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  // Only roles that are allowed to approve bulk changes get the proposal
  // tools at all, so a Sales user can't generate suggestions they could
  // never apply.
  const mayPropose = profile.roles.includes("Office") || isAdminRole(profile);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: "AI assistant isn't configured yet." };

  const trimmedHistory = history.slice(-MAX_HISTORY_MESSAGES).filter((m) => m.content.trim());
  if (trimmedHistory.length === 0) return { error: "Ask a question first." };

  let context: string;
  try {
    context = await buildContext(profile.company_id);
  } catch {
    return { error: "Couldn't load your data right now. Try again in a moment." };
  }

  const system = [
    "You are the AI assistant inside a contractor CRM. Answer the user's questions about their leads, pipeline, schedule, and tasks using ONLY the data provided below.",
    "Be concise and direct — a sentence or short list is usually enough. Use dollar amounts and dates exactly as given.",
    "Respond in plain text only — the chat UI does not render markdown. Do not use **bold**, _italics_, headers, or markdown links. Plain '- ' list items are fine.",
    "If the data below doesn't contain the answer, say so plainly instead of guessing.",
    mayPropose
      ? [
          "You cannot change anything directly. You CAN suggest a change using the propose_* tools, which creates a suggestion the user must review and approve before it takes effect.",
          `Only propose a change when the user clearly asks for one. Never propose speculatively, and never propose more than ${MAX_TARGETS_PER_PROPOSAL} records at once.`,
          "Copy lead and rep ids exactly from the data below — never invent one.",
          "When you propose something, also say in plain text what you proposed and that it needs their approval.",
        ].join("\n")
      : "You cannot take actions (create, edit, or delete anything) — you can only answer questions. If asked to perform an action, explain that and suggest where in the app to do it.",
    "",
    "=== CURRENT DATA ===",
    context,
  ].join("\n");

  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 1024,
      system,
      output_config: { effort: "low" },
      ...(mayPropose ? { tools: PROPOSAL_TOOLS } : {}),
      messages: trimmedHistory.map((m) => ({ role: m.role, content: m.content })),
    });

    if (response.stop_reason === "refusal") {
      return { error: "The assistant couldn't answer that question." };
    }

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    // Tool calls are recorded as pending suggestions and nothing more --
    // no tool_result is returned to the model, so it cannot chain into
    // actually performing the change.
    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    const proposals: ProposalRow[] = [];

    let proposalError = "";

    if (mayPropose && toolUses.length > 0) {
      const supabase = await createClient();
      for (const use of toolUses) {
        const actionType = TOOL_TO_ACTION[use.name];
        if (!actionType) continue;
        const input = (use.input ?? {}) as Record<string, unknown>;
        const leadIds = Array.isArray(input.lead_ids)
          ? input.lead_ids.filter((v): v is string => typeof v === "string")
          : [];
        if (leadIds.length === 0 || leadIds.length > MAX_TARGETS_PER_PROPOSAL) continue;

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
            target_count: leadIds.length,
          })
          .select(
            "id, action_type, params, summary, target_count, status, result, error, created_at, decided_at"
          )
          .maybeSingle();
        if (inserted) proposals.push(inserted as ProposalRow);
        // Surfaced rather than swallowed -- otherwise the assistant would
        // claim it suggested something and no card would ever appear.
        else if (insertError) proposalError = insertError.message;
      }
    }

    const fallback = proposals.length
      ? "I've put that together as a suggestion below — review it and approve if it looks right."
      : "I don't have an answer for that.";

    let reply = text || fallback;
    if (proposalError && proposals.length === 0) {
      reply = `${reply}\n\n(I couldn't save that suggestion for approval: ${proposalError})`;
    }

    return { reply, proposals };
  } catch {
    return { error: "The AI assistant is temporarily unavailable. Try again shortly." };
  }
}
