import { createClient } from "@/lib/supabase/server";
import { getCurrentCompanyId } from "@/lib/data/profile";
import { AdminGate } from "@/components/admin-gate";
import { CallScriptForm } from "./call-script-form";

export default async function CallScriptsPage() {
  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();
  const { data } = await supabase
    .from("company_profile")
    .select("call_script")
    .eq("company_id", companyId ?? "")
    .single();

  return (
    <AdminGate>
      <CallScriptForm initialScript={(data as { call_script: string | null } | null)?.call_script ?? ""} />
    </AdminGate>
  );
}
