"use server";

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import { leadDisplayName, money, type Lead, type Event, type LeadTask, type PipelineStageRow } from "@/lib/data/types";

export type ChatMessage = { role: "user" | "assistant"; content: string };

const MAX_LEADS_IN_CONTEXT = 400;
const MAX_HISTORY_MESSAGES = 12;

function isoDaysFromNow(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function buildContext(companyId: string): Promise<string> {
  const supabase = await createClient();
  const todayISO = new Date().toISOString().slice(0, 10);

  const [{ data: companyProfile }, members, { data: leads }, { data: stages }, { data: events }, { data: tasks }] =
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
  const openLeads = allLeads.filter((l) => l.stage !== "Won" && l.stage !== "Lost");
  const openPipelineValue = openLeads.reduce((sum, l) => sum + (Number(l.value) || 0), 0);

  const leadLines = allLeads.map((l) => {
    const rep = l.assigned_to ? repName.get(l.assigned_to) || "Unassigned" : "Unassigned";
    return `- ${leadDisplayName(l)} | phone: ${l.phone || "—"} | email: ${l.email || "—"} | stage: ${l.stage} | value: ${money(
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

  return [
    `Company: ${companyName}`,
    `Today's date: ${todayISO}`,
    `Pipeline stages (in order): ${stageLines || "none configured"}`,
    "",
    `Summary: ${openLeads.length} open leads worth ${money(openPipelineValue)} total, out of ${allLeads.length} leads shown below (most recent ${MAX_LEADS_IN_CONTEXT}).`,
    "",
    `LEADS (most recent ${allLeads.length}):`,
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
): Promise<{ error?: string; reply?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

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
    "If the data below doesn't contain the answer, say so plainly instead of guessing.",
    "You cannot take actions (create, edit, or delete anything) — you can only answer questions. If asked to perform an action, explain that and suggest where in the app to do it.",
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

    return { reply: text || "I don't have an answer for that." };
  } catch {
    return { error: "The AI assistant is temporarily unavailable. Try again shortly." };
  }
}
