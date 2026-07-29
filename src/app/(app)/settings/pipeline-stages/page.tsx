import { createClient } from "@/lib/supabase/server";
import { getCurrentCompanyId } from "@/lib/data/profile";
import type { PipelineStageRow } from "@/lib/data/types";
import { AdminGate } from "@/components/admin-gate";
import { PipelineStagesTable } from "./pipeline-stages-table";

export default async function PipelineStagesPage() {
  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();
  const { data: stages } = await supabase
    .from("pipeline_stages")
    .select("*")
    .eq("company_id", companyId ?? "")
    .order("sort_order", { ascending: true });

  return (
    <AdminGate>
      <PipelineStagesTable stages={(stages as PipelineStageRow[]) ?? []} />
    </AdminGate>
  );
}
