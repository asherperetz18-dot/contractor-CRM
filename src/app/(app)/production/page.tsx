import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import type { Job, Profile } from "@/lib/data/types";
import { ProductionBoard } from "./production-board";

export default async function ProductionPage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const canWrite =
    (profile?.roles.includes("Office") || profile?.roles.includes("Field")) ?? false;

  const [{ data: jobs }, { data: assignees }] = await Promise.all([
    supabase.from("jobs").select("*").order("created_at", { ascending: false }),
    supabase
      .from("profiles")
      .select("id, name, email, phone, roles, status, created_at")
      .eq("status", "Active")
      .order("name", { ascending: true }),
  ]);

  return (
    <ProductionBoard
      jobs={(jobs as Job[]) ?? []}
      assignees={(assignees as Profile[]) ?? []}
      canWrite={canWrite}
    />
  );
}
