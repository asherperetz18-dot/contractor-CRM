"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { isStrictAdmin, leadDisplayName, type Lead } from "@/lib/data/types";

export type TouchKind = "opened" | "note" | "task" | "appointment" | "call" | "text";

export type LeadTouch = {
  id: string;
  kind: TouchKind;
  leadId: string;
  leadName: string;
  at: string;
  detail: string;
};

export const TOUCH_LABEL: Record<TouchKind, string> = {
  opened: "Opened",
  note: "Note",
  task: "Task",
  appointment: "Appointment",
  call: "Call",
  text: "Text",
};

/**
 * Everything one person did to specific leads in a window.
 *
 * Six sources rather than one activity log, because there isn't one:
 * activity_events records page paths and has no lead reference at all, so
 * "which lead did they touch" can only be answered by the records the
 * actions themselves left behind.
 */
export async function getLeadTouches(
  userId: string,
  sinceISO: string,
  limit = 200
): Promise<{ error?: string; touches?: LeadTouch[] }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isStrictAdmin(profile)) return { error: "Admin access required." };

  const supabase = await createClient();
  const companyId = profile.company_id;

  const [views, notes, tasks, events, calls, texts] = await Promise.all([
    supabase
      .from("lead_views")
      .select("id, lead_id, opened_at")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .gte("opened_at", sinceISO)
      .order("opened_at", { ascending: false })
      .limit(limit),
    supabase
      .from("lead_notes")
      .select("id, lead_id, body, created_at")
      .eq("company_id", companyId)
      .eq("author_id", userId)
      .gte("created_at", sinceISO)
      .limit(limit),
    supabase
      .from("lead_tasks")
      .select("id, lead_id, title, created_at")
      .eq("company_id", companyId)
      .eq("created_by", userId)
      .gte("created_at", sinceISO)
      .limit(limit),
    supabase
      .from("events")
      .select("id, lead_id, title, event_type, created_at")
      .eq("company_id", companyId)
      .eq("created_by", userId)
      .gte("created_at", sinceISO)
      .limit(limit),
    supabase
      .from("call_logs")
      .select("id, lead_id, duration_seconds, created_at")
      .eq("company_id", companyId)
      .eq("rep_id", userId)
      .gte("created_at", sinceISO)
      .limit(limit),
    supabase
      .from("sms_messages")
      .select("id, lead_id, body, created_at")
      .eq("company_id", companyId)
      .eq("sent_by", userId)
      .gte("created_at", sinceISO)
      .limit(limit),
  ]);

  const rows: LeadTouch[] = [];
  const push = (
    kind: TouchKind,
    id: string,
    leadId: string | null,
    at: string,
    detail: string
  ) => {
    if (!leadId) return;
    rows.push({ id: `${kind}:${id}`, kind, leadId, leadName: "", at, detail });
  };

  for (const r of (views.data ?? []) as { id: string; lead_id: string; opened_at: string }[]) {
    push("opened", r.id, r.lead_id, r.opened_at, "Opened the contact card");
  }
  for (const r of (notes.data ?? []) as { id: string; lead_id: string; body: string; created_at: string }[]) {
    push("note", r.id, r.lead_id, r.created_at, r.body.slice(0, 90));
  }
  for (const r of (tasks.data ?? []) as { id: string; lead_id: string; title: string; created_at: string }[]) {
    push("task", r.id, r.lead_id, r.created_at, `Created "${r.title.slice(0, 70)}"`);
  }
  for (const r of (events.data ?? []) as { id: string; lead_id: string | null; title: string | null; event_type: string; created_at: string }[]) {
    push("appointment", r.id, r.lead_id, r.created_at, `Booked ${r.event_type}${r.title ? ` — ${r.title}` : ""}`);
  }
  for (const r of (calls.data ?? []) as { id: string; lead_id: string | null; duration_seconds: number | null; created_at: string }[]) {
    const secs = r.duration_seconds ?? 0;
    push("call", r.id, r.lead_id, r.created_at, secs > 0 ? `Called — ${Math.round(secs / 60)}m` : "Called — no answer");
  }
  for (const r of (texts.data ?? []) as { id: string; lead_id: string | null; body: string | null; created_at: string }[]) {
    push("text", r.id, r.lead_id, r.created_at, `Texted — ${(r.body ?? "").slice(0, 70)}`);
  }

  if (rows.length === 0) return { touches: [] };

  // Names in one round trip rather than one per row.
  const { data: leadRows } = await supabase
    .from("leads")
    .select("id, first_name, last_name, company_name, contact_type, phone")
    .in("id", [...new Set(rows.map((r) => r.leadId))]);
  const nameById = new Map(
    ((leadRows as Lead[] | null) ?? []).map((l) => [l.id, leadDisplayName(l)])
  );
  for (const r of rows) r.leadName = nameById.get(r.leadId) ?? "(deleted contact)";

  rows.sort((a, b) => b.at.localeCompare(a.at));
  return { touches: rows.slice(0, limit) };
}
