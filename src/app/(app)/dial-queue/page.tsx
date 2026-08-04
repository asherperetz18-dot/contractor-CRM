import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/data/select-all";
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
  const companyId = profile?.company_id ?? "";

  const [
    leads,
    { data: stages },
    allReps,
    { data: dispositions },
    { data: callLogs },
    { data: dialLists },
    { data: companyProfile },
  ] = await Promise.all([
    selectAll<Lead>((f, t) =>
      supabase
        .from("leads")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .range(f, t)
    ),
    supabase.from("pipeline_stages").select("*").eq("company_id", companyId).order("sort_order", { ascending: true }),
    profile ? getCompanyMembers(companyId) : Promise.resolve([]),
    supabase.from("call_dispositions").select("*").eq("company_id", companyId).order("sort_order", { ascending: true }),
    supabase
      .from("call_logs")
      .select("id, lead_id, rep_id, direction, from_number, to_number, status, duration_seconds, disposition, recording_url, twilio_call_sid, notes, created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false }),
    supabase.from("dial_lists").select("*").eq("company_id", companyId).order("created_at", { ascending: false }),
    profile
      ? supabase.from("company_profile").select("call_script").eq("company_id", companyId).single()
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
