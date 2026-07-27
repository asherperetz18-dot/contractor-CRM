import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import {
  canUseSalesCenter,
  type CallDispositionRow,
  type CallLog,
  type CompanyProfile,
  type DialList,
  type Lead,
  type PipelineStageRow,
  type Profile,
} from "@/lib/data/types";
import { DialQueueView } from "./dial-queue-view";

export default async function DialQueuePage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const canWrite = canUseSalesCenter(profile);

  const [
    { data: leads },
    { data: stages },
    { data: reps },
    { data: dispositions },
    { data: callLogs },
    { data: dialLists },
    { data: companyProfile },
  ] = await Promise.all([
    supabase.from("leads").select("*").order("created_at", { ascending: false }),
    supabase.from("pipeline_stages").select("*").order("sort_order", { ascending: true }),
    supabase
      .from("profiles")
      .select("id, name, email, phone, roles, status, can_delete_leads, created_at")
      .eq("status", "Active")
      .order("name", { ascending: true }),
    supabase.from("call_dispositions").select("*").order("sort_order", { ascending: true }),
    supabase
      .from("call_logs")
      .select("id, lead_id, rep_id, direction, from_number, to_number, status, duration_seconds, disposition, recording_url, twilio_call_sid, notes, created_at")
      .order("created_at", { ascending: false }),
    supabase.from("dial_lists").select("*").order("created_at", { ascending: false }),
    supabase.from("company_profile").select("call_script").eq("id", 1).single(),
  ]);

  return (
    <DialQueueView
      leads={(leads as Lead[]) ?? []}
      stages={(stages as PipelineStageRow[]) ?? []}
      reps={(reps as Profile[]) ?? []}
      dispositions={(dispositions as CallDispositionRow[]) ?? []}
      callLogs={(callLogs as CallLog[]) ?? []}
      dialLists={(dialLists as DialList[]) ?? []}
      callScript={(companyProfile as Pick<CompanyProfile, "call_script"> | null)?.call_script ?? null}
      canWrite={canWrite}
    />
  );
}
