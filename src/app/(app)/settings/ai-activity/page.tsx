import { createClient } from "@/lib/supabase/server";
import { getCurrentCompanyId } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import { AdminGate } from "@/components/admin-gate";
import { AiActivityView, type AiActivityRow } from "./ai-activity-view";

export default async function AiActivityPage() {
  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();

  const [{ data, error }, members] = await Promise.all([
    companyId
      ? supabase
          .from("ai_action_proposals")
          .select(
            "id, action_type, summary, target_count, status, result, error, created_at, decided_at, proposed_by, decided_by"
          )
          .eq("company_id", companyId)
          .order("created_at", { ascending: false })
          .limit(200)
      : Promise.resolve({ data: null, error: null }),
    companyId ? getCompanyMembers(companyId) : Promise.resolve([]),
  ]);

  // The table ships with migration 0043. Until that's run the page should
  // explain itself rather than render an empty log that looks like "the AI
  // has never done anything".
  const notReady = !!error;

  return (
    <AdminGate>
      <AiActivityView
        rows={(data as AiActivityRow[]) ?? []}
        members={members}
        notReady={notReady}
      />
    </AdminGate>
  );
}
