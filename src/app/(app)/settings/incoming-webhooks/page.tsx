import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getCurrentCompanyId } from "@/lib/data/profile";
import { AdminGate } from "@/components/admin-gate";
import { WebhookSettings } from "./webhook-settings";

export default async function IncomingWebhooksPage() {
  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();
  const { data } = await supabase
    .from("company_profile")
    .select("webhook_secret")
    .eq("company_id", companyId ?? "")
    .single();

  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;

  return (
    <AdminGate>
      <WebhookSettings
        secret={(data as { webhook_secret: string | null } | null)?.webhook_secret ?? null}
        origin={origin}
      />
    </AdminGate>
  );
}
