import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import type { Event, Job, Profile } from "@/lib/data/types";
import { CalendarBoard } from "./calendar-board";

export default async function CalendarPage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const canWrite =
    (profile?.roles.includes("Office") || profile?.roles.includes("Field")) ?? false;

  const [{ data: events }, { data: jobs }, { data: reps }] = await Promise.all([
    supabase.from("events").select("*"),
    supabase.from("jobs").select("*").order("name", { ascending: true }),
    supabase
      .from("profiles")
      .select("id, name, email, phone, roles, status, created_at")
      .eq("status", "Active")
      .order("name", { ascending: true }),
  ]);

  return (
    <CalendarBoard
      events={(events as Event[]) ?? []}
      jobs={(jobs as Job[]) ?? []}
      reps={(reps as Profile[]) ?? []}
      canWrite={canWrite}
    />
  );
}
