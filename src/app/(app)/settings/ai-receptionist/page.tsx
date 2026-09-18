import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { AdminGate } from "@/components/admin-gate";
import { AiReceptionistForm } from "./ai-receptionist-form";

export const dynamic = "force-dynamic";

type Row = {
  ai_receptionist_enabled: boolean;
  ai_receptionist_greeting: string | null;
};

export default async function AiReceptionistSettingsPage() {
  const profile = await getCurrentProfile();
  const supabase = await createClient();
  // Selecting only the 0160 columns: before that migration runs this
  // errors, data stays null, and the form says exactly which file to
  // paste instead of rendering a switch that can't save.
  const { data, error } = await supabase
    .from("company_profile")
    .select("ai_receptionist_enabled, ai_receptionist_greeting")
    .eq("company_id", profile?.company_id ?? "")
    .maybeSingle<Row>();

  return (
    <AdminGate>
      <AiReceptionistForm
        settings={
          data ?? {
            ai_receptionist_enabled: false,
            ai_receptionist_greeting: null,
          }
        }
        configured={!!process.env.ANTHROPIC_API_KEY}
        migrationPending={!!error}
      />
    </AdminGate>
  );
}
