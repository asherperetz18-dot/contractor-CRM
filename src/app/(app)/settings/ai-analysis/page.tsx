import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { AdminGate } from "@/components/admin-gate";
import { AiAnalysisForm } from "./ai-analysis-form";

export const dynamic = "force-dynamic";

type Row = {
  ai_analysis_enabled: boolean;
  ai_analysis_model: string;
  ai_analysis_positive_signals: string | null;
  ai_analysis_negative_signals: string | null;
};

export default async function AiAnalysisSettingsPage() {
  const profile = await getCurrentProfile();
  const supabase = await createClient();
  const { data } = await supabase
    .from("company_profile")
    .select(
      "ai_analysis_enabled, ai_analysis_model, ai_analysis_positive_signals, ai_analysis_negative_signals"
    )
    .eq("company_id", profile?.company_id ?? "")
    .maybeSingle<Row>();

  return (
    <AdminGate>
      <AiAnalysisForm
        settings={
          data ?? {
            ai_analysis_enabled: false,
            ai_analysis_model: "claude-opus-5",
            ai_analysis_positive_signals: null,
            ai_analysis_negative_signals: null,
          }
        }
        configured={!!process.env.ANTHROPIC_API_KEY}
      />
    </AdminGate>
  );
}
