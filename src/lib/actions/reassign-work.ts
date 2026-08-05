"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { isAdminRole, isClosedStage } from "@/lib/data/types";

export type WorkCounts = {
  openLeads: number;
  closedLeads: number;
  upcomingAppointments: number;
  pastAppointments: number;
  openTasks: number;
  completedTasks: number;
};

export type ReassignScope = "open" | "all";

async function requireOfficeOrAdmin(): Promise<{ error: string } | { companyId: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) {
    return { error: "Only Office or Admin users can reassign work." };
  }
  return { companyId: profile.company_id };
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * What a person currently owns, split into work that's still live and
 * work that's already history. Shown before a handover so nobody removes
 * a rep without seeing what walks out with them.
 */
export async function getAssignedWork(userId: string): Promise<{
  error?: string;
  counts?: WorkCounts;
}> {
  const guard = await requireOfficeOrAdmin();
  if ("error" in guard) return guard;

  const supabase = await createClient();
  const today = todayISO();

  const [leadsRes, eventsRes, tasksRes] = await Promise.all([
    supabase
      .from("leads")
      .select("id, stage")
      .eq("company_id", guard.companyId)
      .eq("assigned_to", userId),
    supabase
      .from("events")
      .select("id, date, assigned_to, second_assigned_to")
      .eq("company_id", guard.companyId)
      .or(`assigned_to.eq.${userId},second_assigned_to.eq.${userId}`),
    supabase
      .from("lead_tasks")
      .select("id, completed_at")
      .eq("company_id", guard.companyId)
      .eq("assigned_to", userId),
  ]);

  const leads = (leadsRes.data as { stage: string }[] | null) ?? [];
  const events = (eventsRes.data as { date: string }[] | null) ?? [];
  const tasks = (tasksRes.data as { completed_at: string | null }[] | null) ?? [];

  return {
    counts: {
      openLeads: leads.filter((l) => !isClosedStage(l.stage)).length,
      closedLeads: leads.filter((l) => isClosedStage(l.stage)).length,
      upcomingAppointments: events.filter((e) => e.date >= today).length,
      pastAppointments: events.filter((e) => e.date < today).length,
      openTasks: tasks.filter((t) => !t.completed_at).length,
      completedTasks: tasks.filter((t) => t.completed_at).length,
    },
  };
}

/**
 * Hands a person's work to someone else, or to nobody (`toUserId: null`).
 *
 * `scope: "open"` leaves closed leads, past appointments and completed
 * tasks where they are -- moving those would credit a deal to a rep who
 * didn't close it and rewrite who ran an appointment that already
 * happened. `scope: "all"` takes the history too.
 */
export async function reassignWork(
  fromUserId: string,
  toUserId: string | null,
  scope: ReassignScope
): Promise<{ error?: string; moved?: { leads: number; appointments: number; tasks: number } }> {
  const guard = await requireOfficeOrAdmin();
  if ("error" in guard) return guard;
  if (toUserId && toUserId === fromUserId) {
    return { error: "Pick a different person to hand the work to." };
  }

  const supabase = await createClient();
  const today = todayISO();

  // --- Leads -------------------------------------------------------
  const { data: leadRows, error: leadReadError } = await supabase
    .from("leads")
    .select("id, stage")
    .eq("company_id", guard.companyId)
    .eq("assigned_to", fromUserId);
  if (leadReadError) return { error: leadReadError.message };

  const leadIds = ((leadRows as { id: string; stage: string }[] | null) ?? [])
    .filter((l) => scope === "all" || !isClosedStage(l.stage))
    .map((l) => l.id);

  if (leadIds.length > 0) {
    const { error } = await supabase
      .from("leads")
      .update({ assigned_to: toUserId })
      .in("id", leadIds);
    if (error) return { error: error.message };
  }

  // --- Tasks -------------------------------------------------------
  let taskQuery = supabase
    .from("lead_tasks")
    .select("id")
    .eq("company_id", guard.companyId)
    .eq("assigned_to", fromUserId);
  if (scope === "open") taskQuery = taskQuery.is("completed_at", null);
  const { data: taskRows, error: taskReadError } = await taskQuery;
  if (taskReadError) return { error: taskReadError.message };

  const taskIds = ((taskRows as { id: string }[] | null) ?? []).map((t) => t.id);
  if (taskIds.length > 0) {
    const { error } = await supabase
      .from("lead_tasks")
      .update({ assigned_to: toUserId })
      .in("id", taskIds);
    if (error) return { error: error.message };
  }

  // --- Appointments ------------------------------------------------
  // Row by row rather than a bulk update: an appointment can name this
  // person in either slot, and if the person receiving the work is
  // already the other rep on it, a blind update would list them twice.
  const { data: eventRows, error: eventReadError } = await supabase
    .from("events")
    .select("id, date, assigned_to, second_assigned_to")
    .eq("company_id", guard.companyId)
    .or(`assigned_to.eq.${fromUserId},second_assigned_to.eq.${fromUserId}`);
  if (eventReadError) return { error: eventReadError.message };

  const events = (eventRows as
    | { id: string; date: string; assigned_to: string | null; second_assigned_to: string | null }[]
    | null) ?? [];

  let movedEvents = 0;
  for (const ev of events) {
    if (scope === "open" && ev.date < today) continue;

    const patch: { assigned_to?: string | null; second_assigned_to?: string | null } = {};

    if (ev.assigned_to === fromUserId) {
      patch.assigned_to = toUserId;
      // Receiving rep was already the second one here -- free that slot
      // rather than have the same name in both.
      if (toUserId && ev.second_assigned_to === toUserId) patch.second_assigned_to = null;
    }
    if (ev.second_assigned_to === fromUserId) {
      const primaryAfter = patch.assigned_to !== undefined ? patch.assigned_to : ev.assigned_to;
      patch.second_assigned_to = toUserId && primaryAfter === toUserId ? null : toUserId;
    }

    // An appointment left with a second rep but no primary is a dead end:
    // both reminder crons read assigned_to, so nobody would ever be
    // chased about it. Promote whoever is left.
    const primaryAfter = patch.assigned_to !== undefined ? patch.assigned_to : ev.assigned_to;
    const secondAfter =
      patch.second_assigned_to !== undefined ? patch.second_assigned_to : ev.second_assigned_to;
    if (!primaryAfter && secondAfter) {
      patch.assigned_to = secondAfter;
      patch.second_assigned_to = null;
    }

    const { error } = await supabase.from("events").update(patch).eq("id", ev.id);
    if (error) return { error: error.message };
    movedEvents += 1;
  }

  revalidatePath("/pipeline");
  revalidatePath("/contacts");
  revalidatePath("/calendar");
  revalidatePath("/schedule");
  revalidatePath("/salespeople");
  revalidatePath("/settings/users-roles");

  return {
    moved: { leads: leadIds.length, appointments: movedEvents, tasks: taskIds.length },
  };
}
