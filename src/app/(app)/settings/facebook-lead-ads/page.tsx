import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import type { MetaConfigInput } from "@/lib/actions/settings";
import { AdminGate } from "@/components/admin-gate";
import { MetaSettings } from "./meta-settings";

export default async function FacebookLeadAdsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("company_profile")
    .select("meta_page_id, meta_page_access_token, meta_verify_token, meta_app_secret")
    .eq("id", 1)
    .single();

  const config = data as Partial<MetaConfigInput> | null;
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;

  return (
    <AdminGate>
      <MetaSettings
        origin={origin}
        config={{
          meta_page_id: config?.meta_page_id ?? "",
          meta_page_access_token: config?.meta_page_access_token ?? "",
          meta_verify_token: config?.meta_verify_token ?? "",
          meta_app_secret: config?.meta_app_secret ?? "",
        }}
      />
    </AdminGate>
  );
}
