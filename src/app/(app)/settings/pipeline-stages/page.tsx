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
  const stageRows = (stages as PipelineStageRow[]) ?? [];

  // Head-only counts, one per stage -- never the rows themselves (the
  // imported book is 66k+ contacts in a single stage).
  const counts = Object.fromEntries(
    await Promise.all(
      stageRows.map(async (s) => {
        const { count } = await supabase
          .from("leads")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId ?? "")
          .eq("stage", s.name);
        return [s.name, count ?? 0] as const;
      })
    )
  );

  return (
    <AdminGate>
      <PipelineStagesTable stages={stageRows} counts={counts} />
    </AdminGate>
  );
}
