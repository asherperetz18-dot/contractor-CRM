import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import {
  canUseSalesCenter,
  type CallDispositionRow,
  type CallLog,
  type CompanyProfile,
  type DialList,
  type Lead,
  type PipelineStageRow,
} from "@/lib/data/types";
import { DialQueueView } from "./dial-queue-view";

export default async function DialQueuePage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const canWrite = canUseSalesCenter(profile);

  const [
    { data: leads },
    { data: stages },
    allReps,
    { data: dispositions },
    { data: callLogs },
    { data: dialLists },
    { data: companyProfile },
  ] = await Promise.all([
    supabase.from("leads").select("*").order("created_at", { ascending: false }),
    supabase.from("pipeline_stages").select("*").order("sort_order", { ascending: true }),
    profile ? getCompanyMembers(profile.company_id) : Promise.resolve([]),
    supabase.from("call_dispositions").select("*").order("sort_order", { ascending: true }),
    supabase
      .from("call_logs")
      .select("id, lead_id, rep_id, direction, from_number, to_number, status, duration_seconds, disposition, recording_url, twilio_call_sid, notes, created_at")
      .order("created_at", { ascending: false }),
    supabase.from("dial_lists").select("*").order("created_at", { ascending: false }),
    profile
      ? supabase.from("company_profile").select("call_script").eq("company_id", profile.company_id).single()
      : Promise.resolve({ data: null }),
  ]);
  const reps = allReps.filter((r) => r.status === "Active").sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

  return (
    <DialQueueView
      leads={(leads as Lead[]) ?? []}
      stages={(stages as PipelineStageRow[]) ?? []}
      reps={reps}
      dispositions={(dispositions as CallDispositionRow[]) ?? []}
      callLogs={(callLogs as CallLog[]) ?? []}
      dialLists={(dialLists as DialList[]) ?? []}
      callScript={(companyProfile as Pick<CompanyProfile, "call_script"> | null)?.call_script ?? null}
      canWrite={canWrite}
    />
  );
}
