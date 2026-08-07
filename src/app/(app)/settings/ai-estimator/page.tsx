import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { AdminGate } from "@/components/admin-gate";
import { AiEstimatorForm, type EstimatorSettingsRow } from "./ai-estimator-form";

export const dynamic = "force-dynamic";

export default async function AiEstimatorSettingsPage() {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("company_profile")
    .select(
      "ai_estimator_enabled, ai_estimator_model, ai_estimator_instructions, ai_estimator_rate_card"
    )
    .eq("company_id", profile.company_id)
    .maybeSingle<EstimatorSettingsRow>();

  return (
    <AdminGate>
      <AiEstimatorForm
        settings={
          data ?? {
            ai_estimator_enabled: false,
            ai_estimator_model: "claude-opus-5",
            ai_estimator_instructions: null,
            ai_estimator_rate_card: null,
          }
        }
        configured={!!process.env.ANTHROPIC_API_KEY}
      />
    </AdminGate>
  );
}
