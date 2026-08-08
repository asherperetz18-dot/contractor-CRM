import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { AdminGate } from "@/components/admin-gate";
import { listScopeTemplates } from "@/lib/actions/scope-templates";
import { ScopeLibraryTable } from "./scope-library-table";

export const dynamic = "force-dynamic";

export default async function ScopeLibraryPage() {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const supabase = await createClient();
  const [templates, { data: types }] = await Promise.all([
    listScopeTemplates(),
    supabase
      .from("project_types")
      .select("name")
      .eq("company_id", profile.company_id)
      .order("sort_order", { ascending: true })
      .returns<{ name: string }[]>(),
  ]);

  return (
    <AdminGate>
      <ScopeLibraryTable
        templates={templates}
        projectTypes={(types ?? []).map((t) => t.name)}
      />
    </AdminGate>
  );
}
