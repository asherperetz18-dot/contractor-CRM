import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import type { Lead, LeadTask, Profile } from "@/lib/data/types";
import { PipelineBoard } from "./pipeline-board";

export default async function PipelinePage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const canWrite = profile?.roles.includes("Office") ?? false;

  const [{ data: leads }, { data: tasks }, { data: reps }] = await Promise.all([
    supabase.from("leads").select("*").order("created_at", { ascending: false }),
    supabase
      .from("lead_tasks")
      .select("id, lead_id, title, due_date, completed_at, assigned_to, created_at"),
    supabase
      .from("profiles")
      .select("id, name, email, phone, roles, status, created_at")
      .eq("status", "Active")
      .order("name", { ascending: true }),
  ]);

  return (
    <PipelineBoard
      leads={(leads as Lead[]) ?? []}
      tasks={(tasks as LeadTask[]) ?? []}
      reps={(reps as Profile[]) ?? []}
      canWrite={canWrite}
    />
  );
}
