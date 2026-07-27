import { createClient } from "@/lib/supabase/server";
import { AdminGate } from "@/components/admin-gate";
import { CallScriptForm } from "./call-script-form";

export default async function CallScriptsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("company_profile")
    .select("call_script")
    .eq("id", 1)
    .single();

  return (
    <AdminGate>
      <CallScriptForm initialScript={(data as { call_script: string | null } | null)?.call_script ?? ""} />
    </AdminGate>
  );
}
