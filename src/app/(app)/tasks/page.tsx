import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import { selectAll } from "@/lib/data/select-all";
import { isoDay } from "@/lib/data/date-range";
import { TasksView, type TaskRow } from "./tasks-view";

export const dynamic = "force-dynamic";

type TaskRecord = {
  id: string;
  lead_id: string;
  title: string;
  due_date: string;
  assigned_to: string | null;
};

type TaskLead = {
  id: string;
  contact_type: import("@/lib/data/types").ContactType;
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  stage: string;
  assigned_to: string | null;
};

/**
 * Every open lead task in one place, overdue first.
 *
 * This is the page the dashboard's "Overdue tasks" card opens — its
 * Overdue section counts exactly what the card counts (open tasks due
 * before today, company-wide). The pipeline's Follow-ups strip stays
 * deliberately scoped to the 1,000 newest open leads (it needs each
 * lead's notes for warnings); this page reads the indexed tasks table
 * directly, so it is complete without scanning the book — only the
 * leads the tasks actually reference are fetched, by id.
 */
export default async function TasksPage() {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const supabase = await createClient();
  const companyId = profile.company_id;

  const [tasks, members] = await Promise.all([
    selectAll<TaskRecord>((f, t) =>
      supabase
        .from("lead_tasks")
        .select("id, lead_id, title, due_date, assigned_to")
        .eq("company_id", companyId)
        .is("completed_at", null)
        .order("due_date", { ascending: true })
        .range(f, t)
    ),
    getCompanyMembers(companyId),
  ]);

  // Only the referenced leads ride along — never the book.
  const leadIds = [...new Set(tasks.map((t) => t.lead_id))];
  const leadById = new Map<string, TaskLead>();
  for (let i = 0; i < leadIds.length; i += 200) {
    const { data } = await supabase
      .from("leads")
      .select("id, contact_type, company_name, first_name, last_name, phone, stage, assigned_to")
      .eq("company_id", companyId)
      .in("id", leadIds.slice(i, i + 200));
    for (const l of (data ?? []) as TaskLead[]) leadById.set(l.id, l);
  }

  // A task whose lead RLS hides from this viewer is not theirs to see
  // either — dropped rather than shown as a nameless row.
  const rows: TaskRow[] = tasks
    .map((t) => {
      const lead = leadById.get(t.lead_id);
      return lead ? { ...t, lead } : null;
    })
    .filter((r): r is TaskRow => r !== null);

  // Name lookups read the whole roster on purpose — narrowing them
  // turns historical assignees into "Unnamed".
  const repNames = Object.fromEntries(
    members.map((m) => [m.id, m.name || m.email || "Unnamed"])
  ) as Record<string, string>;

  // Completing writes to lead_tasks, which RLS grants to Office; Admin
  // holds every gate. Everyone else still reads the list.
  const canComplete =
    profile.roles.includes("Office") || profile.roles.includes("Admin");

  return (
    <TasksView
      rows={rows}
      repNames={repNames}
      today={isoDay(new Date())}
      canComplete={canComplete}
    />
  );
}
