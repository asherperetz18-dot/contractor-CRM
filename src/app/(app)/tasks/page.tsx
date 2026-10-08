import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import { getCompanyZone } from "@/lib/data/company-today";
import { selectAll } from "@/lib/data/select-all";
import { isoDay } from "@/lib/data/date-range";
import { briefPeriodStart } from "@/lib/daily-brief";
import { doneAtLabel, parseDonePeriod } from "@/lib/tasks-done";
import { TasksView, type TaskRow } from "./tasks-view";

export const dynamic = "force-dynamic";

type TaskRecord = {
  id: string;
  lead_id: string;
  title: string;
  due_date: string;
  assigned_to: string | null;
  completed_at: string | null;
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
 *
 * `?done=today|week|month` lists the tasks marked done in that period
 * instead — the Daily Brief's Tasks Completed tile, itemized, on the
 * brief's own period starts so the two agree.
 */
export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const supabase = await createClient();
  const companyId = profile.company_id;
  const done = parseDonePeriod((await searchParams).done);
  // Done is the Daily Brief's periods, on the company's clock. The open
  // tasks' today stays the server's day, as the dashboard's Overdue Tasks
  // card reads it, so the section matches the card that opens it; both
  // move to the company's clock together (TECH_DEBT).
  const zone = await getCompanyZone();
  const now = new Date();
  const today = isoDay(now);

  const [tasks, members] = await Promise.all([
    selectAll<TaskRecord>((f, t) => {
      if (done) {
        const { since } = briefPeriodStart(done, now, zone);
        return supabase
          .from("lead_tasks")
          .select("id, lead_id, title, due_date, assigned_to, completed_at")
          .eq("company_id", companyId)
          .gte("completed_at", since)
          .order("completed_at", { ascending: false })
          .order("id")
          .range(f, t);
      }
      return supabase
        .from("lead_tasks")
        .select("id, lead_id, title, due_date, assigned_to, completed_at")
        .eq("company_id", companyId)
        .is("completed_at", null)
        .order("due_date", { ascending: true })
        .range(f, t);
    }),
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
      if (!lead) return null;
      const { completed_at, ...task } = t;
      return { ...task, lead, doneAt: completed_at ? doneAtLabel(completed_at, zone) : null };
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
    // Keyed by view: switching Open / Done is a link to this same page,
    // and the list it keeps in state would otherwise outlive the switch.
    <TasksView
      key={done ?? "open"}
      rows={rows}
      repNames={repNames}
      today={today}
      canComplete={canComplete}
      done={done}
    />
  );
}
