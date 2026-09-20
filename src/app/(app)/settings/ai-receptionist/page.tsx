import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { AdminGate } from "@/components/admin-gate";
import { AiReceptionistForm } from "./ai-receptionist-form";

export const dynamic = "force-dynamic";

type Row = {
  ai_receptionist_enabled: boolean;
  ai_receptionist_greeting: string | null;
  call_forward_timeout: number | null;
};

type TransferRow = {
  ai_receptionist_transfer_number: string | null;
};

export default async function AiReceptionistSettingsPage() {
  const profile = await getCurrentProfile();
  const supabase = await createClient();
  // Selecting only the 0160 columns (plus call_forward_timeout, which
  // predates all of this): before that migration runs this errors, data
  // stays null, and the form says exactly which file to paste instead
  // of rendering a switch that can't save.
  const { data, error } = await supabase
    .from("company_profile")
    .select("ai_receptionist_enabled, ai_receptionist_greeting, call_forward_timeout")
    .eq("company_id", profile?.company_id ?? "")
    .maybeSingle<Row>();

  // The transfer column arrives with 0161 — its own select on purpose,
  // so a company that has run 0160 but not 0161 still gets a working
  // page with only the transfer field flagged.
  const { data: transferData, error: transferError } = await supabase
    .from("company_profile")
    .select("ai_receptionist_transfer_number")
    .eq("company_id", profile?.company_id ?? "")
    .maybeSingle<TransferRow>();

  return (
    <AdminGate>
      <AiReceptionistForm
        settings={
          data ?? {
            ai_receptionist_enabled: false,
            ai_receptionist_greeting: null,
            call_forward_timeout: null,
          }
        }
        transferNumber={transferData?.ai_receptionist_transfer_number ?? null}
        configured={!!process.env.ANTHROPIC_API_KEY}
        migrationPending={!!error}
        transferPending={!!transferError}
      />
    </AdminGate>
  );
}
