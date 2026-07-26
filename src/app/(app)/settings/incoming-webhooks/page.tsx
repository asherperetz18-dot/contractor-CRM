import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { WebhookSettings } from "./webhook-settings";

export default async function IncomingWebhooksPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("company_profile")
    .select("webhook_secret")
    .eq("id", 1)
    .single();

  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;

  return (
    <WebhookSettings
      secret={(data as { webhook_secret: string | null } | null)?.webhook_secret ?? null}
      origin={origin}
    />
  );
}
