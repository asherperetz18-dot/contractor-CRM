import { createClient } from "@/lib/supabase/server";
import type { LeadSourceRow } from "@/lib/data/types";
import { AdminGate } from "@/components/admin-gate";
import { FieldOptionsTable } from "../field-options-table";

export default async function LeadSourcesPage() {
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("lead_sources")
    .select("*")
    .order("sort_order", { ascending: true });

  return (
    <AdminGate>
      <FieldOptionsTable
        table="lead_sources"
        title="Lead Sources"
        description="Manage the list of sources available when creating or editing a lead"
        itemLabel="Source"
        rows={(rows as LeadSourceRow[]) ?? []}
      />
    </AdminGate>
  );
}
