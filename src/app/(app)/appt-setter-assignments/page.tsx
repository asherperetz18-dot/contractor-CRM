import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { canEditDispatch, type Lead, type Profile, type SetterContact } from "@/lib/data/types";
import { SetterAssignments } from "./setter-assignments";

export default async function ApptSetterAssignmentsPage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const canWrite = canEditDispatch(profile);

  const [{ data: reps }, { data: leads }, { data: assignments }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, name, email, phone, roles, status, created_at")
      .eq("status", "Active")
      .order("name", { ascending: true }),
    supabase.from("leads").select("*").order("created_at", { ascending: false }),
    supabase.from("setter_contacts").select("*"),
  ]);

  return (
    <SetterAssignments
      reps={(reps as Profile[]) ?? []}
      leads={(leads as Lead[]) ?? []}
      assignments={(assignments as SetterContact[]) ?? []}
      canWrite={canWrite}
    />
  );
}
