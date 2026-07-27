import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import {
  canEditDispatch,
  type CallDispositionRow,
  type CallLog,
  type Lead,
  type Profile,
} from "@/lib/data/types";
import { CallReportsView } from "./call-reports-view";

export default async function CallReportsPage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const canWrite = canEditDispatch(profile);

  const [{ data: callLogs }, { data: leads }, { data: reps }, { data: dispositions }] =
    await Promise.all([
      supabase.from("call_logs").select("*").order("created_at", { ascending: false }),
      supabase.from("leads").select("*"),
      supabase
        .from("profiles")
        .select("id, name, email, phone, roles, status, can_delete_leads, created_at"),
      supabase.from("call_dispositions").select("*").order("sort_order", { ascending: true }),
    ]);

  return (
    <CallReportsView
      callLogs={(callLogs as CallLog[]) ?? []}
      leads={(leads as Lead[]) ?? []}
      reps={(reps as Profile[]) ?? []}
      dispositions={(dispositions as CallDispositionRow[]) ?? []}
      canWrite={canWrite}
    />
  );
}
