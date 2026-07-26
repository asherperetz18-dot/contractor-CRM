import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import type { Lead } from "@/lib/data/types";
import { PipelineBoard } from "./pipeline-board";

export default async function PipelinePage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const canWrite = profile?.roles.includes("Office") ?? false;

  const { data: leads } = await supabase
    .from("leads")
    .select("*")
    .order("created_at", { ascending: false });

  return <PipelineBoard leads={(leads as Lead[]) ?? []} canWrite={canWrite} />;
}
