import { createClient } from "@/lib/supabase/server";
import type { PipelineStageRow } from "@/lib/data/types";
import { AdminGate } from "@/components/admin-gate";
import { PipelineStagesTable } from "./pipeline-stages-table";

export default async function PipelineStagesPage() {
  const supabase = await createClient();
  const { data: stages } = await supabase
    .from("pipeline_stages")
    .select("*")
    .order("sort_order", { ascending: true });

  return (
    <AdminGate>
      <PipelineStagesTable stages={(stages as PipelineStageRow[]) ?? []} />
    </AdminGate>
  );
}
