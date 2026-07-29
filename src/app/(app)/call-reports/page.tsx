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
  const companyId = profile?.company_id ?? "";

  const [{ data: callLogs }, { data: leads }, reps, { data: dispositions }] =
    await Promise.all([
      supabase.from("call_logs").select("*").eq("company_id", companyId).order("created_at", { ascending: false }),
      supabase.from("leads").select("*").eq("company_id", companyId),
      profile ? getCompanyMembers(companyId) : Promise.resolve([]),
      supabase.from("call_dispositions").select("*").eq("company_id", companyId).order("sort_order", { ascending: true }),
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
