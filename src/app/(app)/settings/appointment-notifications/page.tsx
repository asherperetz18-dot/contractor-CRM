import { createClient } from "@/lib/supabase/server";
import { getCurrentCompanyId } from "@/lib/data/profile";
import type { CompanyProfile, SmsQuickText } from "@/lib/data/types";
import { AdminGate } from "@/components/admin-gate";
import { AppointmentNotificationsForm } from "./appointment-notifications-form";

export default async function AppointmentNotificationsPage() {
  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();
  const [{ data: companyProfile }, { data: quickTexts }] = await Promise.all([
    supabase
      .from("company_profile")
      .select(
        "no_show_followup_enabled, no_show_grace_minutes, no_show_lookback_hours, rep_appointment_info_template"
      )
      .eq("company_id", companyId ?? "")
      .single(),
    supabase
      .from("sms_quick_texts")
      .select("*")
      .eq("company_id", companyId ?? "")
      .order("key", { ascending: true }),
  ]);

  return (
    <AdminGate>
      <AppointmentNotificationsForm
        followUp={
          companyProfile as Pick<
            CompanyProfile,
            "no_show_followup_enabled" | "no_show_grace_minutes" | "no_show_lookback_hours"
          > | null
        }
        repInfoTemplate={
          (companyProfile as Pick<CompanyProfile, "rep_appointment_info_template"> | null)
            ?.rep_appointment_info_template ?? null
        }
        quickTexts={(quickTexts as SmsQuickText[]) ?? []}
      />
    </AdminGate>
  );
}
