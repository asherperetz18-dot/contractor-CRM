import { createClient } from "@/lib/supabase/server";
import { getCurrentCompanyId } from "@/lib/data/profile";
import type { CallDispositionRow } from "@/lib/data/types";
import { AdminGate } from "@/components/admin-gate";
import { CallDispositionsTable } from "./call-dispositions-table";

export default async function CallDispositionsPage() {
  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();
  const [{ data: dispositions }, { data: stages }] = await Promise.all([
    supabase
      .from("call_dispositions")
      .select("*")
      .eq("company_id", companyId ?? "")
      .order("sort_order", { ascending: true }),
    supabase
      .from("pipeline_stages")
      .select("name")
      .eq("company_id", companyId ?? "")
      .order("sort_order", { ascending: true }),
  ]);

  return (
    <AdminGate>
      <CallDispositionsTable
        dispositions={(dispositions as CallDispositionRow[]) ?? []}
        stageNames={((stages as { name: string }[]) ?? []).map((s) => s.name)}
      />
    </AdminGate>
  );
}
