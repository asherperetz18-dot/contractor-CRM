import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import {
  canUseSalesCenter,
  type CallDispositionRow,
  type CallLog,
  type Lead,
} from "@/lib/data/types";
import { CallReportsView } from "./call-reports-view";

export default async function CallReportsPage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const canWrite = canUseSalesCenter(profile);

  const [{ data: callLogs }, { data: leads }, reps, { data: dispositions }] =
    await Promise.all([
      supabase.from("call_logs").select("*").order("created_at", { ascending: false }),
      supabase.from("leads").select("*"),
      profile ? getCompanyMembers(profile.company_id) : Promise.resolve([]),
      supabase.from("call_dispositions").select("*").order("sort_order", { ascending: true }),
    ]);

  return (
    <CallReportsView
      callLogs={(callLogs as CallLog[]) ?? []}
      leads={(leads as Lead[]) ?? []}
      reps={reps}
      dispositions={(dispositions as CallDispositionRow[]) ?? []}
      canWrite={canWrite}
    />
  );
}
