import { createClient } from "@/lib/supabase/server";
import { getCurrentCompanyId } from "@/lib/data/profile";
import type { ProjectTypeRow } from "@/lib/data/types";
import { AdminGate } from "@/components/admin-gate";
import { FieldOptionsTable } from "../field-options-table";
import { MergeValues } from "../merge-values";

export default async function ProjectTypesPage() {
  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();
  const { data: rows } = await supabase
    .from("project_types")
    .select("*")
    .eq("company_id", companyId ?? "")
    .order("sort_order", { ascending: true });

  return (
    <AdminGate>
      <FieldOptionsTable
        table="project_types"
        title="Project Types"
        description="Manage the list of project types available when creating or editing a lead"
        itemLabel="Project Type"
        rows={(rows as ProjectTypeRow[]) ?? []}
      />
      <MergeValues table="project_types" itemLabel="Project type" />
    </AdminGate>
  );
}
